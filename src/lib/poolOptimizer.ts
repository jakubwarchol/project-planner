/**
 * Pool optimizer — the zero-sum sibling of the ceiling autopilot. Given the
 * portfolio and its order as fixed, it looks for FTE moves *between* capability
 * pools that meet more deadlines and finish everything sooner on average, and
 * says why it stopped.
 *
 * The interchangeability of people is assumed outright — this is the model's
 * theoretical mode, the same one team variants live in. Every move is therefore
 * a claim about headcount allocation, not about any particular person, and the
 * search works in quarters because a quarter of a person is the smallest
 * staffing decision worth a human's attention. Derived figures stay continuous;
 * only the decisions are quantized.
 *
 * Like the autopilot, what comes back is a *proposal with a price tag*, never a
 * plan: each move carries its cost and the per-project deltas show who loses.
 * Ceilings are deliberately not variables here — a search free to raise
 * `maxFte` would raise every one of them and declare victory, so pace-setting
 * ceilings are reported for the human to challenge in Wyceny instead.
 */
import { CAPABILITY_ORDER, monthsNeeded, totalCapabilityEffortDays } from "./estimation";
import { simulateCapabilitySchedule, type CapabilitySchedule, type SimulateInput } from "./scheduling";
import type { Capability, CapabilityVector } from "../types";

const EPS = 1e-6;

/** Move granularity — the quarters every staffing decision is quantized to. */
export const QUARTER = 0.25;

/** When no quarter helps, one coarse retry. The scheduler's cliffs are step
 *  functions — a phase's minimum crew, `min-above-pool` — so "0.25 does
 *  nothing but 1.0 heals the project" is a real case, not a rounding artefact. */
export const RESCUE_STEP = 1.0;

/** Consolidated moves, each a real staffing conversation. The autopilot's 12
 *  were fine-grained single-cell steps; these are whole rebalances. */
export const MAX_MOVES = 6;

/** Extra increments a round's winner may absorb before it is committed as one
 *  thick move — a single move tops out at 8 quarters, two whole people. */
export const MAX_EXTENSION = 7;

/** Months of summed end dates a move must buy to be worth proposing — about a
 *  week across the portfolio. Below that is under the model's own noise floor
 *  (estimates in whole days, staffing in quarters). Deadline improvements are
 *  integer-valued and exempt. */
export const MIN_GAIN = 0.25;

/** Simulations per stepSearch call — ~4 × 14 ms keeps the tab responsive while
 *  running the search four times faster than one-sim-per-tick would. */
export const SIMS_PER_STEP = 4;

/** Max total FTE movable from one capability to another. People are
 *  interchangeable *within* a capability, never across — so a pair is movable
 *  only when someone on the roster really holds both, and only up to what
 *  those people currently give the donor side. An absent pair is not movable
 *  at all. Omitting the whole map runs the theoretical mode: any pair, no cap
 *  — the "what team would this portfolio want" question, a recruitment shape
 *  rather than an executable plan. */
export type TransferLimits = Partial<Record<Capability, Partial<Record<Capability, number>>>>;

/** Everything the search needs, minus the pools it is searching over. The
 *  caller precomputes deadline months so the lib stays date-free — the same
 *  contract `earliestStart` already uses: `monthsFrom(nowMonth, deadlineDate)`
 *  per project, past deadlines included un-clamped. */
export type PoolSearchInput = Omit<SimulateInput, "pools"> & {
  deadlineMonths: Record<string, number>;
  transferLimits?: TransferLimits;
};

/** Lexicographic, compared field by field in declaration order. The
 *  `impossible` tier exists because an impossible project has
 *  `endMonths = Infinity` — summing it would poison `sumEndMonths` and
 *  counting it as "missed" is wrong for a project with no deadline. So
 *  pre-existing impossible projects are fixed background, a move that makes
 *  one *newly* impossible is rejected outright, and a move that heals one is
 *  the biggest possible win. */
export interface PlanScore {
  /** Projects that never finish. */
  impossible: number;
  /** Possible projects with a deadline ending after it. */
  missedDeadlines: number;
  /** Sum of endMonths over possible projects — finite by construction. */
  sumEndMonths: number;
}

export interface PoolMove {
  from: Capability;
  to: Capability;
  /** Positive multiple of QUARTER — consolidated, one line per rebalance. */
  fte: number;
  /** Score after this move with every earlier move applied. */
  scoreAfter: PlanScore;
  /** vs the state before this move; negative is better. A healing move
   *  (deltaImpossible < 0) legitimately *raises* deltaSumEnds — the healed
   *  project's end rejoins the sum — so the UI must read this tier first. */
  deltaImpossible: number;
  deltaMissed: number;
  deltaSumEnds: number;
  poolFromAfter: number;
  poolToAfter: number;
}

export type BlockedPoolReason = "pool" | "no-effect" | "worse" | "impossible";

export interface BlockedPoolCandidate {
  from: Capability;
  /** Absent for "pool" — the donor has nothing to give *any* receiver, which
   *  is recorded once per donor rather than once per pair. */
  to?: Capability;
  reason: BlockedPoolReason;
  /** Present for "worse". */
  deltaMissed?: number;
  /** Present for "worse" and for sub-threshold "no-effect" gains. */
  deltaSumEnds?: number;
  poolFrom: number;
}

/** Baseline vs full proposal, one entry per project — the "who loses" data.
 *  `before`/`after` are Infinity for an impossible project; `delta` is 0 when
 *  both sides are impossible and ±Infinity when exactly one is, so it never
 *  goes NaN. `missed*` is false for impossible ends — that is a different,
 *  worse category, and the view names it directly. */
export interface ProjectEndDelta {
  projectId: string;
  before: number;
  after: number;
  delta: number;
  missedBefore: boolean;
  missedAfter: boolean;
}

/** What +1.0 FTE of a capability would buy — measured on the vector *after*
 *  the proposed moves, because hiring is what remains once redistribution has
 *  saturated. A separate report, never mixed into the zero-sum proposal. */
export interface HiringEntry {
  capability: Capability;
  score: PlanScore;
  deltaMissed: number;
  deltaSumEnds: number;
}

/** A pace-setting cell in the final plan. When `ceilingBound`, the cell's
 *  ceiling — not the pool — is the binding limit: the case to take to the
 *  Wyceny ceiling autopilot, because no team move can touch it. */
export interface CeilingBinding {
  projectId: string;
  capability: Capability;
  maxFte: number;
  pool: number;
  ceilingBound: boolean;
}

/** Arithmetic floors on the portfolio horizon, both ignoring phasing,
 *  ceilings, minimum crews, leaves and earliest starts — a bound, never a
 *  promise. `fungibleMonths` is invariant under zero-sum moves, which is
 *  exactly why it is worth showing: it is what no redistribution can beat. */
export interface FloorDiagnostic {
  /** max over demanded capabilities of days / (pool × rate); Infinity when a
   *  demanded capability has no pool. */
  perCapabilityMonths: number;
  binding: Capability | null;
  /** Σ(days / rate) / Σ pools — the floor if FTE were perfectly fungible. */
  fungibleMonths: number;
}

export interface PoolOptimizerResult {
  moves: PoolMove[];
  /** The final round's rejections — the durable answer to "why not faster". */
  blocked: BlockedPoolCandidate[];
  scoreBefore: PlanScore;
  scoreAfter: PlanScore;
  poolsBefore: CapabilityVector;
  poolsAfter: CapabilityVector;
  projectDeltas: ProjectEndDelta[];
  /** 7 entries in CAPABILITY_ORDER. */
  hiring: HiringEntry[];
  ceilings: CeilingBinding[];
  floorBefore: FloorDiagnostic;
  floorAfter: FloorDiagnostic;
  simulations: number;
  /** Ran out of the move budget rather than out of ideas. */
  truncated: boolean;
}

export function scoreOf(
  schedule: CapabilitySchedule,
  deadlineMonths: Record<string, number>,
): PlanScore {
  let impossible = 0;
  let missedDeadlines = 0;
  let sumEndMonths = 0;
  for (const sp of schedule.scheduled) {
    if (sp.isImpossible || !Number.isFinite(sp.endMonths)) {
      impossible += 1;
      continue;
    }
    sumEndMonths += sp.endMonths;
    const deadline = deadlineMonths[sp.project.id];
    if (deadline !== undefined && sp.endMonths > deadline + EPS) missedDeadlines += 1;
  }
  return { impossible, missedDeadlines, sumEndMonths };
}

/** < 0 when `a` is lexicographically better. Integer tiers compare exactly;
 *  the months tier treats differences within EPS as a tie. */
export function compareScores(a: PlanScore, b: PlanScore): number {
  if (a.impossible !== b.impossible) return a.impossible - b.impossible;
  if (a.missedDeadlines !== b.missedDeadlines) return a.missedDeadlines - b.missedDeadlines;
  const d = a.sumEndMonths - b.sumEndMonths;
  return Math.abs(d) <= EPS ? 0 : d;
}

/** Strict acceptance: any integer-tier improvement, or a months gain worth a
 *  move. Merely-not-worse is not enough — that is what keeps the proposal
 *  short and every line meaningful. */
function improvesEnough(before: PlanScore, after: PlanScore): boolean {
  if (after.impossible !== before.impossible) return after.impossible < before.impossible;
  if (after.missedDeadlines !== before.missedDeadlines) {
    return after.missedDeadlines < before.missedDeadlines;
  }
  return before.sumEndMonths - after.sumEndMonths >= MIN_GAIN - EPS;
}

function shifted(
  pools: CapabilityVector,
  from: Capability,
  to: Capability,
  step: number,
): CapabilityVector {
  return { ...pools, [from]: pools[from] - step, [to]: pools[to] + step };
}

/** `base` plus the accepted moves — every move when `accepted` is omitted.
 *  No clamping and no rounding: the caller owns the write boundary. */
export function composeVector(
  base: CapabilityVector,
  moves: PoolMove[],
  accepted?: ReadonlySet<number>,
): CapabilityVector {
  const out = { ...base };
  moves.forEach((move, index) => {
    if (accepted && !accepted.has(index)) return;
    out[move.from] -= move.fte;
    out[move.to] += move.fte;
  });
  return out;
}

export function floorDiagnostic(
  input: Pick<PoolSearchInput, "projects" | "cells" | "effectiveDaysPerMonth">,
  pools: CapabilityVector,
): FloorDiagnostic {
  const demand = totalCapabilityEffortDays(input.projects, input.cells);
  let perCapabilityMonths = 0;
  let binding: Capability | null = null;
  let fungibleFteMonths = 0;
  let totalPool = 0;
  for (const capability of CAPABILITY_ORDER) {
    totalPool += pools[capability];
    const days = demand[capability];
    if (days <= EPS) continue;
    const rate = input.effectiveDaysPerMonth[capability];
    fungibleFteMonths += rate > EPS ? days / rate : Infinity;
    const months = monthsNeeded(days, pools[capability], rate);
    if (months > perCapabilityMonths) {
      perCapabilityMonths = months;
      binding = capability;
    }
  }
  const fungibleMonths =
    totalPool > EPS ? fungibleFteMonths / totalPool : fungibleFteMonths > 0 ? Infinity : 0;
  return { perCapabilityMonths, binding, fungibleMonths };
}

interface Winner {
  from: Capability;
  to: Capability;
  pools: CapabilityVector;
  schedule: CapabilitySchedule;
  score: PlanScore;
}

interface Round {
  step: number;
  queue: { from: Capability; to: Capability }[];
  index: number;
  best: Winner | null;
  rejected: BlockedPoolCandidate[];
}

/**
 * Greedy hill-climb, mirrored from the autopilot: each round simulates every
 * donor→receiver quarter, commits the best as one thickened move, and repeats
 * until nothing clears the bar. Split across calls for the same reason the
 * autopilot is — a full proposal is hundreds of simulations, long enough that
 * one synchronous burst freezes the tab before the spinner paints.
 */
export interface SearchState {
  input: PoolSearchInput;
  pools: CapabilityVector;
  schedule: CapabilitySchedule;
  score: PlanScore;
  poolsBefore: CapabilityVector;
  scoreBefore: PlanScore;
  endsBefore: Record<string, number>;
  /** Σ cell days per capability — receivers without demand are pruned. */
  demand: CapabilityVector;
  /** Gross FTE moved per `${from}>${to}` pair, for the transfer limits. A
   *  reverse move restores capacity — the person shifted back is the person
   *  shifted there — so remaining capacity is netted across both directions. */
  movedByPair: Record<string, number>;
  moves: PoolMove[];
  blocked: BlockedPoolCandidate[];
  phase: "search" | "hiring" | "done";
  round: Round | null;
  /** This round is the coarse retry at RESCUE_STEP. */
  rescued: boolean;
  hiring: HiringEntry[];
  hiringIndex: number;
  simulations: number;
  truncated: boolean;
}

export function createSearch(pools: CapabilityVector, input: PoolSearchInput): SearchState {
  const poolsBefore = { ...pools };
  const { deadlineMonths, transferLimits: _limits, ...simInput } = input;
  const schedule = simulateCapabilitySchedule({ ...simInput, pools: poolsBefore });
  const score = scoreOf(schedule, deadlineMonths);
  const endsBefore: Record<string, number> = {};
  for (const sp of schedule.scheduled) {
    endsBefore[sp.project.id] = sp.isImpossible ? Infinity : sp.endMonths;
  }
  return {
    input,
    pools: { ...pools },
    schedule,
    score,
    poolsBefore,
    scoreBefore: score,
    endsBefore,
    demand: totalCapabilityEffortDays(input.projects, input.cells),
    movedByPair: {},
    moves: [],
    blocked: [],
    phase: "search",
    round: null,
    rescued: false,
    hiring: [],
    hiringIndex: 0,
    simulations: 1,
    truncated: false,
  };
}

/** FTE still movable from→to under the input's limits — Infinity when the
 *  limits are absent (theoretical mode). Netted: a reverse move restores the
 *  capacity it consumed. */
function transferLeft(state: SearchState, from: Capability, to: Capability): number {
  const limits = state.input.transferLimits;
  if (!limits) return Infinity;
  const cap = limits[from]?.[to] ?? 0;
  const net = (state.movedByPair[`${from}>${to}`] ?? 0) - (state.movedByPair[`${to}>${from}`] ?? 0);
  return cap - net;
}

function buildRound(state: SearchState, step: number): Round {
  const queue: Round["queue"] = [];
  const rejected: BlockedPoolCandidate[] = [];
  for (const from of CAPABILITY_ORDER) {
    if (state.pools[from] < step - EPS) {
      rejected.push({ from, reason: "pool", poolFrom: state.pools[from] });
      continue;
    }
    for (const to of CAPABILITY_ORDER) {
      if (to === from) continue;
      // No demand anywhere in the portfolio — pool added here provably funds
      // nothing. Donors are *not* demand-filtered: a pool with people and no
      // work is the ideal donor.
      if (state.demand[to] <= EPS) continue;
      // Nobody on the roster links these two capabilities (or those who do
      // are already fully shifted) — skipped silently, not blocked: the
      // constraint is structural, not a finding of this search.
      if (transferLeft(state, from, to) < step - EPS) continue;
      queue.push({ from, to });
    }
  }
  return { step, queue, index: 0, best: null, rejected };
}

/** Runs one budgeted slice. Returns true once there is nothing left to do. */
export function stepSearch(state: SearchState): boolean {
  if (state.phase === "done") return true;

  const { deadlineMonths, transferLimits: _limits, ...simInput } = state.input;
  const simulate = (pools: CapabilityVector): CapabilitySchedule => {
    state.simulations += 1;
    return simulateCapabilitySchedule({ ...simInput, pools });
  };

  if (state.phase === "hiring") {
    const capability = CAPABILITY_ORDER[state.hiringIndex];
    const trial = { ...state.pools, [capability]: state.pools[capability] + 1 };
    const trialScore = scoreOf(simulate(trial), deadlineMonths);
    state.hiring.push({
      capability,
      score: trialScore,
      deltaMissed: trialScore.missedDeadlines - state.score.missedDeadlines,
      deltaSumEnds: trialScore.sumEndMonths - state.score.sumEndMonths,
    });
    state.hiringIndex += 1;
    if (state.hiringIndex >= CAPABILITY_ORDER.length) {
      state.phase = "done";
      return true;
    }
    return false;
  }

  if (!state.round) {
    state.round = buildRound(state, state.rescued ? RESCUE_STEP : QUARTER);
  }
  const round = state.round;

  let budget = SIMS_PER_STEP;
  while (budget > 0 && round.index < round.queue.length) {
    const { from, to } = round.queue[round.index];
    round.index += 1;
    budget -= 1;
    const trial = shifted(state.pools, from, to, round.step);
    const trialSchedule = simulate(trial);
    const trialScore = scoreOf(trialSchedule, deadlineMonths);
    if (trialScore.impossible > state.score.impossible) {
      round.rejected.push({ from, to, reason: "impossible", poolFrom: state.pools[from] });
    } else if (compareScores(trialScore, state.score) > 0) {
      round.rejected.push({
        from,
        to,
        reason: "worse",
        deltaMissed: trialScore.missedDeadlines - state.score.missedDeadlines,
        deltaSumEnds: trialScore.sumEndMonths - state.score.sumEndMonths,
        poolFrom: state.pools[from],
      });
    } else if (!improvesEnough(state.score, trialScore)) {
      round.rejected.push({
        from,
        to,
        reason: "no-effect",
        deltaSumEnds: trialScore.sumEndMonths - state.score.sumEndMonths,
        poolFrom: state.pools[from],
      });
    } else if (!round.best || compareScores(trialScore, round.best.score) < 0) {
      // Tie on the full tuple keeps the earlier candidate — CAPABILITY_ORDER
      // makes the choice deterministic.
      round.best = { from, to, pools: trial, schedule: trialSchedule, score: trialScore };
    }
  }
  if (round.index < round.queue.length) return false;

  if (!round.best) {
    if (!state.rescued) {
      state.rescued = true;
      state.round = null;
      return false;
    }
    state.blocked = round.rejected;
    state.phase = "hiring";
    return false;
  }

  // Thicken the winner in place: same pair, same step, while each increment
  // still pays. One consolidated "BE → QA · 1,0" instead of four quarter
  // lines burning four rounds of simulations and four of the move budget.
  let winner = round.best;
  const { from, to } = winner;
  const pairLeft = transferLeft(state, from, to);
  let increments = 1;
  while (
    increments <= MAX_EXTENSION &&
    winner.pools[from] >= round.step - EPS &&
    (increments + 1) * round.step <= pairLeft + EPS
  ) {
    const trial = shifted(winner.pools, from, to, round.step);
    const trialSchedule = simulate(trial);
    const trialScore = scoreOf(trialSchedule, deadlineMonths);
    if (trialScore.impossible > winner.score.impossible) break;
    if (!improvesEnough(winner.score, trialScore)) break;
    winner = { from, to, pools: trial, schedule: trialSchedule, score: trialScore };
    increments += 1;
  }

  state.moves.push({
    from,
    to,
    fte: increments * round.step,
    scoreAfter: winner.score,
    deltaImpossible: winner.score.impossible - state.score.impossible,
    deltaMissed: winner.score.missedDeadlines - state.score.missedDeadlines,
    deltaSumEnds: winner.score.sumEndMonths - state.score.sumEndMonths,
    poolFromAfter: winner.pools[from],
    poolToAfter: winner.pools[to],
  });
  state.pools = winner.pools;
  state.schedule = winner.schedule;
  state.score = winner.score;
  const pairKey = `${from}>${to}`;
  state.movedByPair[pairKey] = (state.movedByPair[pairKey] ?? 0) + increments * round.step;
  state.rescued = false;
  const rejected = round.rejected;
  state.round = null;

  if (state.moves.length >= MAX_MOVES) {
    // Out of budget, not out of ideas. Only the pool blocks are carried
    // through — they are the ones that stay true however long you search.
    state.truncated = true;
    state.blocked = rejected.filter((r) => r.reason === "pool");
    state.phase = "hiring";
  }
  return false;
}

/** The pace-setting cells of the final plan, deduplicated the way the
 *  autopilot's `paceSetters` are — PM straddles both phases but there is only
 *  one ceiling to challenge. */
function ceilingBindings(schedule: CapabilitySchedule, pools: CapabilityVector): CeilingBinding[] {
  const seen = new Set<string>();
  const out: CeilingBinding[] = [];
  for (const sp of schedule.scheduled) {
    for (const stream of sp.streams) {
      if (!stream.setsPace) continue;
      const key = `${sp.project.id}:${stream.capability}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pool = pools[stream.capability];
      out.push({
        projectId: sp.project.id,
        capability: stream.capability,
        maxFte: stream.maxFte,
        pool,
        ceilingBound: stream.maxFte < pool - EPS,
      });
    }
  }
  return out;
}

/** Per-project deltas of `schedule` against baseline ends — also what the UI
 *  uses to re-price an accepted subset, so it lives here rather than in the
 *  hook. */
export function projectDeltasOf(
  schedule: CapabilitySchedule,
  endsBefore: Record<string, number>,
  deadlineMonths: Record<string, number>,
): ProjectEndDelta[] {
  return schedule.scheduled.map((sp) => {
    const before = endsBefore[sp.project.id] ?? 0;
    const after = sp.isImpossible || !Number.isFinite(sp.endMonths) ? Infinity : sp.endMonths;
    const deadline = deadlineMonths[sp.project.id];
    const missedOf = (end: number) =>
      deadline !== undefined && Number.isFinite(end) && end > deadline + EPS;
    const delta = !Number.isFinite(before) && !Number.isFinite(after) ? 0 : after - before;
    return {
      projectId: sp.project.id,
      before,
      after,
      delta,
      missedBefore: missedOf(before),
      missedAfter: missedOf(after),
    };
  });
}

export function searchResult(state: SearchState): PoolOptimizerResult {
  const { deadlineMonths } = state.input;
  return {
    moves: state.moves,
    blocked: state.blocked,
    scoreBefore: state.scoreBefore,
    scoreAfter: state.score,
    poolsBefore: state.poolsBefore,
    poolsAfter: { ...state.pools },
    projectDeltas: projectDeltasOf(state.schedule, state.endsBefore, deadlineMonths),
    hiring: state.hiring,
    ceilings: ceilingBindings(state.schedule, state.pools),
    floorBefore: floorDiagnostic(state.input, state.poolsBefore),
    floorAfter: floorDiagnostic(state.input, state.pools),
    simulations: state.simulations,
    truncated: state.truncated,
  };
}
