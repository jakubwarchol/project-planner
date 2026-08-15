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
  /** Portfolio horizon after this move, with every earlier move applied. */
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
  schedule: ReturnType<typeof simulateCapabilitySchedule>;
  horizonBefore: number;
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
  const schedule = simulateCapabilitySchedule({ ...input, cells: current });
  return {
    input,
    cells: current,
    schedule,
    horizonBefore: horizonOf(schedule),
    moves: [],
    blocked: [],
    simulations: 1,
    maxMoves,
    truncated: false,
    done: false,
  };
}

export function searchResult(state: SearchState): AutopilotResult {
  return {
    moves: state.moves,
    blocked: state.blocked,
    horizonBefore: state.horizonBefore,
    horizonAfter: horizonOf(state.schedule),
    simulations: state.simulations,
    truncated: state.truncated,
  };
}

/** Runs one round. Returns true once there is nothing left to find. */
export function stepSearch(state: SearchState): boolean {
  if (state.done) return true;

  const { input } = state;
  const simulate = (c: Cells) => {
    state.simulations++;
    return simulateCapabilitySchedule({ ...input, cells: c });
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
    let best: { move: CeilingMove; cells: Cells; score: PlanScore } | null = null;

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
        best = { move, cells: trial, score: trialScore };
      }
    }

    const chosen = best;
    if (!chosen) {
      state.blocked = rejected;
      state.done = true;
      return true;
    }
    moves.push(chosen.move);
    current = chosen.cells;
    schedule = simulate(current);
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
      state.done = true;
      return true;
    }
  }
  return false;
}
