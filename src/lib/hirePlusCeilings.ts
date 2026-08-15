/**
 * Hire-plus-ceilings ladder (tryb 2): "if we hired N people AND re-cut the
 * work, what does the plan look like?"
 *
 * Mode 1 (`hiringPlanner.ts`) goes flat after the first hire: the plan stops
 * being people-bound and becomes bound by `maxFte` ceilings, so new people
 * have nowhere to go. This mode pulls both levers in one proposal — each rung
 * of the ladder is "hire one more person, then let the ceiling loop re-cut
 * the work for that team".
 *
 * Three structural decisions, argued in docs/hiring-and-ceilings.md:
 *
 * - Greedy, width 1 — not mode 1's beam. A beam holds four different teams
 *   per level, so "exhaust ceilings for the current team" has no addressee,
 *   and a raise loop per beam node costs minutes. The insurance the beam
 *   bought (a hire that only pays off in company) is largely taken over by
 *   the raises, which restore the gradient the flat ladder was missing.
 *
 * - Raises are computed fresh from the pristine matrix at every rung, never
 *   accumulated. A raise that helped a small team can hurt a bigger one (it
 *   lifts the phase-opening threshold), and the loop can only raise — without
 *   accumulation there is nothing to un-do, and each rung is a self-contained
 *   answer: "N hires plus this complete raise set". Neighbouring rungs' sets
 *   need not nest.
 *
 * - Hire candidates are scored on the parent rung's raised cells, plus the
 *   pool-blocked hint: the raise loop reports moves it wanted but could not
 *   staff (`blocked: "pool"`), so a hire that unblocks one is tested together
 *   with it. Without the hint every candidate looks flat — the ceiling, not
 *   the headcount, is binding — and the choice would be arbitrary.
 *
 * Rung 0 is a real rung: today's team, work re-cut. Careful one-step raises
 * can genuinely shorten today's plan even before anyone is hired.
 */
import {
  createSearch,
  stepSearch,
  type BlockedCandidate,
  type CeilingMove,
  type SearchState,
} from "./autopilot";
import { CAPABILITY_ORDER, totalCapabilityEffortDays } from "./estimation";
import {
  HIRE_STEP,
  MAX_HIRES,
  type BlockedHire,
  type CapabilityCaps,
  type HiringPlanInput,
} from "./hiringPlanner";
import { compareScores, scoreOf, type PlanScore } from "./planRules";
import { simulateCapabilitySchedule } from "./scheduling";
import type { Capability, CapabilityCell, CapabilityVector } from "../types";

const EPS = 1e-6;

/** Raise-loop budget per rung. Small on purpose: the interesting raises are
 *  always first, this cost is paid on every rung, and every extra move is
 *  another claim a human has to check. */
export const MAX_MOVES_PER_RUNG = 6;

type Cells = Record<string, Record<Capability, CapabilityCell>>;

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

export interface LadderRung {
  /** People hired at this rung; 0 is today's team with the work re-cut. */
  hires: number;
  /** Hires per capability; capabilities not hired into are absent. */
  byCapability: Partial<Record<Capability, number>>;
  pools: CapabilityVector;
  /** This rung's complete raise set, fresh from the pristine matrix. Apply
   *  all of them (they chain per cell: 1→1.5, 1.5→2) to reproduce the score. */
  ceilingMoves: CeilingMove[];
  /** The raise loop hit its per-rung budget rather than running dry. */
  raisesTruncated: boolean;
  score: PlanScore;
  horizonMonths: number;
  /** Against today's team with nothing raised; negative is the improvement. */
  deltaImpossible: number;
  deltaHorizon: number;
  deltaSumEnds: number;
  /** The hire that created this rung; absent on rung 0. */
  addedCapability?: Capability;
}

export interface LadderResult {
  /** Today: base team, pristine ceilings. */
  base: { pools: CapabilityVector; score: PlanScore; horizonMonths: number };
  /** Rung 0 first, then one per hire, ascending. */
  rungs: LadderRung[];
  blocked: BlockedHire[];
  simulations: number;
}

interface PendingRung {
  byCapability: Partial<Record<Capability, number>>;
  pools: CapabilityVector;
  addedCapability?: Capability;
}

interface HireTrial {
  capability: Capability;
  pools: CapabilityVector;
  score: PlanScore;
}

export interface LadderState {
  readonly input: HiringPlanInput;
  readonly base: CapabilityVector;
  readonly caps: CapabilityCaps;
  readonly maxHires: number;
  readonly pristine: Cells;
  /** Capabilities worth hiring into at all; caps are re-checked per rung. */
  readonly candidates: Capability[];
  readonly blocked: BlockedHire[];
  baseScore: PlanScore;
  rungs: LadderRung[];
  /** Team whose raise loop is in flight. */
  pending: PendingRung | null;
  raise: SearchState | null;
  /** The finished rung's raised cells and unstaffable raises — the landscape
   *  the next hire candidates are scored against. */
  lastCells: Cells;
  lastPoolBlocked: BlockedCandidate[];
  hireQueue: Capability[];
  hireTrials: HireTrial[];
  simulations: number;
  done: boolean;
}

function autopilotInput(state: LadderState, pools: CapabilityVector) {
  const { deadlineMonths: _d, caps: _c, maxHires: _m, cells: _cells, ...rest } = state.input;
  return { ...rest, pools };
}

function simulate(state: LadderState, pools: CapabilityVector, cells: Cells): PlanScore {
  const { deadlineMonths, caps: _c, maxHires: _m, ...simInput } = state.input;
  const schedule = simulateCapabilitySchedule({ ...simInput, pools, cells });
  state.simulations += 1;
  return scoreOf(schedule, deadlineMonths);
}

export function createLadder(base: CapabilityVector, input: HiringPlanInput): LadderState {
  const caps = input.caps ?? {};
  const maxHires = Math.max(0, Math.min(MAX_HIRES, input.maxHires ?? MAX_HIRES));
  const demand = totalCapabilityEffortDays(input.projects, input.cells);

  const candidates: Capability[] = [];
  const blocked: BlockedHire[] = [];
  for (const capability of CAPABILITY_ORDER) {
    if ((demand[capability] ?? 0) <= 0) {
      blocked.push({ capability, reason: "no-demand" });
      continue;
    }
    const cap = caps[capability];
    const pool = base[capability] ?? 0;
    if (cap !== undefined && pool + HIRE_STEP > cap + EPS) {
      blocked.push({ capability, reason: "cap", cap, pool });
      continue;
    }
    candidates.push(capability);
  }

  const state: LadderState = {
    input,
    base,
    caps,
    maxHires,
    pristine: input.cells,
    candidates,
    blocked,
    baseScore: { impossible: 0, missedDeadlines: 0, horizonMonths: 0, sumEndMonths: 0 },
    rungs: [],
    pending: { byCapability: {}, pools: base },
    raise: null,
    lastCells: input.cells,
    lastPoolBlocked: [],
    hireQueue: [],
    hireTrials: [],
    simulations: 0,
    done: false,
  };

  state.baseScore = simulate(state, base, state.pristine);
  // Rung 0: today's team, work re-cut.
  state.raise = createSearch(state.pristine, autopilotInput(state, base), MAX_MOVES_PER_RUNG);
  return state;
}

/** Capabilities still hireable on top of `pools` — the team cap is re-checked
 *  every rung because greedy growth can exhaust it mid-ladder. */
function hireable(state: LadderState, pools: CapabilityVector): Capability[] {
  return state.candidates.filter((capability) => {
    const cap = state.caps[capability];
    return cap === undefined || (pools[capability] ?? 0) + HIRE_STEP <= cap + EPS;
  });
}

function finishRaise(state: LadderState): void {
  const raise = state.raise!;
  const pending = state.pending!;
  state.simulations += raise.simulations;
  const score = scoreOf(raise.schedule, state.input.deadlineMonths);
  const hires = Object.values(pending.byCapability).reduce((sum, n) => sum + (n ?? 0), 0);

  state.rungs.push({
    hires,
    byCapability: { ...pending.byCapability },
    pools: pending.pools,
    ceilingMoves: raise.moves,
    raisesTruncated: raise.truncated,
    score,
    horizonMonths: score.horizonMonths,
    deltaImpossible: score.impossible - state.baseScore.impossible,
    deltaHorizon: score.horizonMonths - state.baseScore.horizonMonths,
    deltaSumEnds: score.sumEndMonths - state.baseScore.sumEndMonths,
    addedCapability: pending.addedCapability,
  });

  state.lastCells = raise.cells;
  state.lastPoolBlocked = raise.blocked.filter((b) => b.reason === "pool");
  state.raise = null;
  state.pending = null;

  if (hires >= state.maxHires) {
    state.done = true;
    return;
  }
  state.hireQueue = hireable(state, state.rungs[state.rungs.length - 1].pools);
  state.hireTrials = [];
  if (state.hireQueue.length === 0) state.done = true;
}

/** Score one hire candidate: one simulation on the parent rung's raised
 *  cells, and — when the extra person unblocks raises the parent's loop
 *  wanted but could not staff — one more with those raises applied. */
function tryHire(state: LadderState, capability: Capability): void {
  const parent = state.rungs[state.rungs.length - 1];
  const pools = { ...parent.pools, [capability]: (parent.pools[capability] ?? 0) + HIRE_STEP };

  let score = simulate(state, pools, state.lastCells);

  const cleared = state.lastPoolBlocked.filter(
    (b) => b.capability === capability && b.to <= Math.max(1, pools[capability]) + EPS,
  );
  if (cleared.length > 0) {
    const hinted = cloneCells(state.lastCells);
    for (const b of cleared) {
      const cell = hinted[b.projectId][b.capability];
      if (b.to > cell.maxFte) cell.maxFte = b.to;
    }
    const hintedScore = simulate(state, pools, hinted);
    if (compareScores(hintedScore, score) < 0) score = hintedScore;
  }

  state.hireTrials.push({ capability, pools, score });
}

function pickHire(state: LadderState): void {
  const parent = state.rungs[state.rungs.length - 1];
  let best = state.hireTrials[0];
  for (const trial of state.hireTrials.slice(1)) {
    if (compareScores(trial.score, best.score) < 0) best = trial;
  }
  state.pending = {
    byCapability: {
      ...parent.byCapability,
      [best.capability]: (parent.byCapability[best.capability] ?? 0) + 1,
    },
    pools: best.pools,
    addedCapability: best.capability,
  };
  state.hireTrials = [];
  // Fresh from the pristine matrix — decision 2. The hint raises were only a
  // scoring aid; the rung's real raise set is recomputed for its real team.
  state.raise = createSearch(
    state.pristine,
    autopilotInput(state, best.pools),
    MAX_MOVES_PER_RUNG,
  );
}

/** One tick: one raise-loop round or one hire trial. Returns true when the
 *  whole ladder is finished. Same contract as `stepPlan` / `stepSearch`, so
 *  the hook driving it is the same shape. */
export function stepLadder(state: LadderState): boolean {
  if (state.done) return true;

  if (state.raise) {
    if (stepSearch(state.raise)) finishRaise(state);
    return state.done;
  }

  const next = state.hireQueue.shift();
  if (next === undefined) {
    // Queue drained: commit the best candidate and start its raise loop.
    if (state.hireTrials.length === 0) {
      state.done = true;
      return true;
    }
    pickHire(state);
    return false;
  }
  tryHire(state, next);
  return false;
}

export function ladderResult(state: LadderState): LadderResult {
  return {
    base: {
      pools: state.base,
      score: state.baseScore,
      horizonMonths: state.baseScore.horizonMonths,
    },
    rungs: state.rungs,
    blocked: state.blocked,
    simulations: state.simulations,
  };
}

/** Sugar for tests and any caller happy to block: run to completion. */
export function runLadder(base: CapabilityVector, input: HiringPlanInput): LadderResult {
  const state = createLadder(base, input);
  while (!stepLadder(state)) {
    /* keep stepping */
  }
  return ladderResult(state);
}
