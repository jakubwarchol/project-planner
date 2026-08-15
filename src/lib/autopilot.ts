/**
 * Ceiling autopilot — finds the handful of `maks. obsada` cells worth raising,
 * and says why it stopped.
 *
 * The search is small for a reason that falls out of the crew model rather than
 * out of any cleverness here. In a phase every capability finishes on the same
 * day, so only the one pinned at its own ceiling is actually flat out; the rest
 * are deliberately de-rated to stay in formation, and raising a ceiling they
 * are already under is provably a no-op. That leaves roughly one live candidate
 * per phase instead of one per cell — and the moment you raise it, the pace
 * moves to a different capability, which is both the next candidate and the
 * natural stopping condition.
 *
 * What it returns is a *proposal*, never a plan. Every move is the machine
 * asserting "more people could usefully work on this", which is a claim about
 * the world it has no way to check — it has not seen the codebase, the
 * onboarding cost, or whether the work splits at all. It only knows where the
 * question is worth asking. The human answers it.
 */
import { CAPABILITY_ORDER } from "./estimation";
import {
  CEILING_STEP,
  ceilingRaiseBlock,
  compareScores,
  scoreOf,
  type CeilingRaiseBlock,
  type PlanScore,
} from "./planRules";
import { simulateCapabilitySchedule, type SimulateInput } from "./scheduling";
import type { Capability, CapabilityCell } from "../types";

const EPS = 1e-6;

/** A runaway search is worse than a short one: every extra move is another
 *  claim a human has to check, and the interesting ones are always first. */
const MAX_MOVES = 12;

export interface CeilingMove {
  projectId: string;
  capability: Capability;
  from: number;
  to: number;
  /** Portfolio horizon after this move, with every earlier move applied.
   *  This and the two deltas below are measured under the search's own
   *  evaluator (`fidelity: "search"`), so they are consistent with each
   *  other but can sit a hair off the exact `horizonBefore`/`horizonAfter`
   *  pair on the result — those two are re-simulated at "exact". */
  horizonAfter: number;
  /** Negative is an improvement — months off the whole plan. */
  deltaHorizon: number;
  /** Months off this project's own end date. Often much larger than the
   *  horizon delta: finishing one project sooner rarely moves the last one. */
  deltaProject: number;
  /** That capability's whole pool, for context in the proposal. */
  pool: number;
}

export type BlockedReason = CeilingRaiseBlock | "no-effect" | "worse" | "impossible";

export interface BlockedCandidate {
  projectId: string;
  capability: Capability;
  from: number;
  to: number;
  reason: BlockedReason;
  /** Months the plan would move — positive is worse. Absent for `pool`. */
  deltaHorizon?: number;
  pool: number;
}

export interface AutopilotResult {
  moves: CeilingMove[];
  /** Every pace-setting cell the search could not use, and why. This is the
   *  more useful half of the output once the easy moves are gone: "pula UX =
   *  1.0" is the real answer to "why isn't this faster". */
  blocked: BlockedCandidate[];
  horizonBefore: number;
  horizonAfter: number;
  simulations: number;
  /** Ran out of the move budget rather than out of ideas. */
  truncated: boolean;
}

type Cells = Record<string, Record<Capability, CapabilityCell>>;

/** Everything the search needs, minus the cells it is searching over. */
export type AutopilotInput = Omit<SimulateInput, "cells">;

function cloneCells(cells: Cells): Cells {
  const out: Cells = {};
  for (const projectId of Object.keys(cells)) {
    const row = {} as Record<Capability, CapabilityCell>;
    for (const capability of CAPABILITY_ORDER) {
      const cell = cells[projectId][capability];
      row[capability] = { days: cell.days, maxFte: cell.maxFte };
    }
    out[projectId] = row;
  }
  return out;
}

/** Infinite when anything became unschedulable — a plan with a project that
 *  never finishes is not an improvement on one that merely takes a while. */
function horizonOf(schedule: { scheduled: { isImpossible: boolean }[]; horizonMonths: number }): number {
  return schedule.scheduled.some((p) => p.isImpossible) ? Infinity : schedule.horizonMonths;
}

interface Candidate {
  projectId: string;
  capability: Capability;
}

/** The pace-setters, deduplicated: PM straddles both phases and can be pinned
 *  in each, but there is only one cell to raise. */
function paceSetters(schedule: {
  scheduled: { project: { id: string }; streams: { capability: Capability; setsPace: boolean }[] }[];
}): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const sp of schedule.scheduled) {
    for (const stream of sp.streams) {
      if (!stream.setsPace) continue;
      const key = `${sp.project.id}:${stream.capability}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ projectId: sp.project.id, capability: stream.capability });
    }
  }
  return out;
}

function endOf(
  schedule: { scheduled: { project: { id: string }; endMonths: number }[] },
  projectId: string,
): number {
  return schedule.scheduled.find((p) => p.project.id === projectId)?.endMonths ?? 0;
}

/**
 * Greedy hill-climb, one round at a time: raise whichever pace-setter buys the
 * most, re-simulate, repeat until nothing helps.
 *
 * Greedy rather than exhaustive on purpose. The moves interact — raising one
 * ceiling changes which cell is even a candidate next round — so there is no
 * fixed set to enumerate, and the objective is not convex: past a point a
 * bigger crew needs *more people simultaneously free* before its phase may
 * open, so it queues longer than it builds faster. Those moves come back
 * positive and are reported as `worse` rather than silently skipped, because
 * "adding people here would delay the plan" is worth reading.
 *
 * Split per round rather than run in one call: a full proposal is a couple of
 * hundred simulations and takes seconds on a real backlog — long enough that
 * one synchronous burst freezes the tab so hard the spinner never paints.
 * Stepping lets the caller hand the frame back between rounds and show honest
 * progress.
 */
export interface SearchState {
  input: AutopilotInput;
  cells: Cells;
  /** While the search runs: the current best plan at "search" fidelity, the
   *  evaluator every candidate is compared under. Once `done`, it is replaced
   *  by an "exact" re-simulation of the final cells, so everything a caller
   *  reads off a finished search is display-grade. */
  schedule: ReturnType<typeof simulateCapabilitySchedule>;
  /** Untouched copy of the cells the search started from, for the exact
   *  "before" re-simulation in `searchResult`. */
  originalCells: Cells;
  /** Exact-fidelity horizon of `originalCells`, computed lazily by
   *  `searchResult` and cached here. */
  exactHorizonBefore?: number | null;
  moves: CeilingMove[];
  blocked: BlockedCandidate[];
  simulations: number;
  maxMoves: number;
  truncated: boolean;
  done: boolean;
}

/** `maxMoves` defaults to the Wyceny budget; the hire-plus-ceilings ladder
 *  passes a smaller one because it pays this cost once per rung. */
export function createSearch(
  cells: Cells,
  input: AutopilotInput,
  maxMoves: number = MAX_MOVES,
): SearchState {
  const current = cloneCells(cells);
  const schedule = simulateCapabilitySchedule({ ...input, cells: current, fidelity: "search" });
  return {
    input,
    cells: current,
    originalCells: cloneCells(cells),
    schedule,
    moves: [],
    blocked: [],
    simulations: 1,
    maxMoves,
    truncated: false,
    done: false,
  };
}

export function searchResult(state: SearchState): AutopilotResult {
  // `horizonBefore` has to match what the timeline showed before the drawer
  // opened, and the timeline simulates at "exact" — so when any move was
  // accepted the before is re-simulated exactly rather than read off the
  // search-fidelity evaluator. With no moves the exact final schedule *is*
  // the unchanged plan, so before and after are the same number by
  // construction. Cached on the state: assembling a result twice should not
  // cost a second simulation.
  if (state.moves.length > 0 && state.exactHorizonBefore == null) {
    state.simulations += 1;
    state.exactHorizonBefore = horizonOf(
      simulateCapabilitySchedule({ ...state.input, cells: state.originalCells }),
    );
  }
  return {
    moves: state.moves,
    blocked: state.blocked,
    horizonBefore: state.moves.length > 0 ? state.exactHorizonBefore! : horizonOf(state.schedule),
    horizonAfter: horizonOf(state.schedule),
    simulations: state.simulations,
    truncated: state.truncated,
  };
}

/** Runs one round. Returns true once there is nothing left to find. */
export function stepSearch(state: SearchState): boolean {
  if (state.done) return true;

  const { input } = state;
  // Candidates are ranked under "search" fidelity — cheap, and both sides of
  // every comparison carry the same pessimism. The one exception is the
  // finalization below, which re-simulates the finished plan at "exact".
  const simulate = (c: Cells) => {
    state.simulations++;
    return simulateCapabilitySchedule({ ...input, cells: c, fidelity: "search" });
  };
  // Once the search is over, the schedule a caller reads scores off must be
  // display-grade: rung scores in Symulacje and the proposal's horizon in
  // Wyceny both come from here, and both sit next to numbers the timeline
  // computed at "exact".
  const finalize = () => {
    state.simulations++;
    state.schedule = simulateCapabilitySchedule({ ...input, cells: state.cells });
    state.done = true;
  };
  let current = state.cells;
  let schedule = state.schedule;
  const moves = state.moves;

  {
    const hereScore = scoreOf(schedule);
    const rejected: BlockedCandidate[] = [];
    // "Better" is the shared rulebook's compareScores, and its tiers carry the
    // whole selection: a move that shortens the horizon wins outright, and one
    // that only finishes some project sooner (a lower sum of ends at the same
    // horizon) is still an improvement worth taking — it frees capacity
    // earlier and takes something off the board. Without that second tier the
    // search would stall the moment two projects are tied for last, which on
    // a real backlog is most of the time.
    let best: {
      move: CeilingMove;
      cells: Cells;
      score: PlanScore;
      schedule: ReturnType<typeof simulateCapabilitySchedule>;
    } | null = null;

    for (const candidate of paceSetters(schedule)) {
      const cell = current[candidate.projectId]?.[candidate.capability];
      if (!cell || cell.days <= EPS) continue;

      const pool = input.pools[candidate.capability];
      const from = cell.maxFte;
      const to = from + CEILING_STEP;

      const block = ceilingRaiseBlock(candidate.capability, from, pool);
      if (block) {
        rejected.push({ ...candidate, from, to, reason: block, pool });
        continue;
      }

      const trial = cloneCells(current);
      trial[candidate.projectId][candidate.capability].maxFte = to;
      const trialSchedule = simulate(trial);
      const trialScore = scoreOf(trialSchedule);
      const deltaHorizon = trialScore.horizonMonths - hereScore.horizonMonths;

      if (trialScore.impossible > hereScore.impossible) {
        rejected.push({ ...candidate, from, to, reason: "impossible", pool });
        continue;
      }
      const cmp = compareScores(trialScore, hereScore);
      if (cmp > 0) {
        rejected.push({ ...candidate, from, to, reason: "worse", deltaHorizon, pool });
        continue;
      }
      if (cmp === 0) {
        rejected.push({ ...candidate, from, to, reason: "no-effect", deltaHorizon, pool });
        continue;
      }

      const deltaProject =
        endOf(trialSchedule, candidate.projectId) - endOf(schedule, candidate.projectId);
      const move: CeilingMove = {
        ...candidate,
        from,
        to,
        horizonAfter: trialScore.horizonMonths,
        deltaHorizon,
        deltaProject,
        pool,
      };

      if (!best || compareScores(trialScore, best.score) < 0) {
        best = { move, cells: trial, score: trialScore, schedule: trialSchedule };
      }
    }

    const chosen = best;
    if (!chosen) {
      state.blocked = rejected;
      finalize();
      return true;
    }
    moves.push(chosen.move);
    // The chosen candidate's trial schedule is the schedule of the new
    // current cells — simulating them again would only recompute it.
    current = chosen.cells;
    schedule = chosen.schedule;
    state.cells = current;
    state.schedule = schedule;

    if (moves.length >= state.maxMoves) {
      // Out of budget, not out of ideas. Only the blocks that stay true
      // however long you search are carried through — the rulebook's, and
      // the pool's.
      state.truncated = true;
      state.blocked = rejected.filter(
        (r) => r.reason === "pool" || r.reason === "forbidden" || r.reason === "max-ceiling",
      );
      finalize();
      return true;
    }
  }
  return false;
}
