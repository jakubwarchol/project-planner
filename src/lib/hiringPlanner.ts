/**
 * Hiring planner: "if we hired N people, which capabilities would buy the most
 * plan?"
 *
 * The portfolio and its order are fixed. The only lever here is headcount, and
 * headcount is bought one whole person at a time — this is the question you ask
 * a budget holder, so half a hire is not an answer. For every N from 1 up to
 * `maxHires` the planner reports the best split of those N hires across
 * capabilities, scored by simulating the real schedule.
 *
 * It deliberately does NOT move FTE between capabilities. People are
 * specialists; a plan that reads "take 1 FTE off BE and put it on UX" is not
 * something a team can execute, and pretending otherwise made the previous
 * version of this screen worse than useless.
 *
 * `caps` is what keeps the answer sane. Left alone, a search like this will
 * happily propose four tech leads, because the model has no idea that a team
 * wants exactly one. A cap is a ceiling on a capability's total FTE *on the
 * team* (existing pool included), so "TL: 1" means the search may not grow TL
 * past one person however much it would help.
 *
 * Search: beam over levels. Level N holds the best `BEAM_WIDTH` splits of N
 * hires; each is expanded by one more hire in every capability that still has
 * demand and cap room, deduped by multiset so the same split is never
 * simulated twice. Exhaustive would be 3431 simulations for seven hires across
 * seven capabilities — around a minute — where the beam costs a few hundred.
 * The beam can in principle miss a split whose payoff only appears at the last
 * hire; the width is what buys that back, and every scenario it does report is
 * a real simulated plan, never an extrapolation.
 */
import { CAPABILITY_ORDER, totalCapabilityEffortDays } from "./estimation";
import { simulateCapabilitySchedule, type CapabilitySchedule, type SimulateInput } from "./scheduling";
import type { Capability, CapabilityVector } from "../types";

const EPS = 1e-6;

/** One hire is one person. Fractions belong to allocations, not to headcount
 *  decisions — you cannot recruit 0.25 of a tester. */
export const HIRE_STEP = 1;

/** Seven is where the question stops being a hiring plan and starts being a
 *  reorganisation, and it is also one per capability. */
export const MAX_HIRES = 7;

/** Splits carried forward per level. Four is enough that a capability which
 *  only pays off in company (UX with a second UX) survives the level where it
 *  looks flat, without paying for the full combinatorial sweep. */
export const BEAM_WIDTH = 4;

/** Simulations per animation tick — the main thread has to stay answerable.
 *  One simulation is ~14 ms on a real portfolio, so this is ~56 ms of work. */
export const SIMS_PER_STEP = 4;

/** Max total FTE a capability may reach on the team, existing pool included.
 *  Absent means unbounded. A cap at or below today's pool simply freezes that
 *  capability — the planner never proposes firing anyone. */
export type CapabilityCaps = Partial<Record<Capability, number>>;

export type HiringPlanInput = Omit<SimulateInput, "pools"> & {
  /** Per project, `monthsFrom(nowMonth, deadlineDate)` — the lib stays
   *  date-free, exactly as `earliestStart` already does. */
  deadlineMonths: Record<string, number>;
  caps?: CapabilityCaps;
  maxHires?: number;
};

/** Lexicographic, compared field by field in declaration order.
 *
 *  `impossible` leads because a project that never finishes has
 *  `endMonths = Infinity`: summing it would poison `sumEndMonths`, and calling
 *  it "missed" is wrong for a project that has no deadline to miss. Healing one
 *  is the biggest win a hire can produce, so it outranks any number of months.
 *
 *  `horizonMonths` sits above `sumEndMonths` because the question this screen
 *  answers is "when is all of this done". Ranking on the sum alone rewards
 *  finishing many projects a little sooner even when that pushes the *last*
 *  one later — which showed up as hiring two people and watching the plan get
 *  longer than with one. The sum stays as the tie-break, so among teams that
 *  finish together the one that delivers earlier on average still wins. */
export interface PlanScore {
  impossible: number;
  missedDeadlines: number;
  /** When the last project finishes; 0 when nothing is schedulable. */
  horizonMonths: number;
  sumEndMonths: number;
}

export interface HiringScenario {
  /** How many people this scenario hires — 1…maxHires. */
  hires: number;
  /** Hires per capability; capabilities not hired into are absent. */
  byCapability: Partial<Record<Capability, number>>;
  /** Team after the hires: base pools plus this scenario's additions. */
  pools: CapabilityVector;
  score: PlanScore;
  /** Whole-plan length, i.e. when the last project finishes. */
  horizonMonths: number;
  /** Against the current team; negative months are the improvement. */
  deltaImpossible: number;
  deltaMissed: number;
  deltaSumEnds: number;
  deltaHorizon: number;
  /** What this scenario adds on top of the previous one, when it is a strict
   *  superset of it — lets the UI read the list as a hiring order rather than
   *  seven unrelated answers. Absent when the best split changed shape. */
  addedCapability?: Capability;
}

export type BlockedHireReason = "cap" | "no-demand";

export interface BlockedHire {
  capability: Capability;
  reason: BlockedHireReason;
  /** For "cap": the ceiling that stopped it, and today's pool. */
  cap?: number;
  pool?: number;
}

export interface HiringPlanResult {
  base: { pools: CapabilityVector; score: PlanScore; horizonMonths: number };
  /** One per hire count, ascending. Shorter than maxHires when caps run out. */
  scenarios: HiringScenario[];
  blocked: BlockedHire[];
  simulations: number;
}

export function scoreOf(
  schedule: CapabilitySchedule,
  deadlineMonths: Record<string, number>,
): PlanScore {
  let impossible = 0;
  let missedDeadlines = 0;
  let sumEndMonths = 0;
  let horizonMonths = 0;
  for (const sp of schedule.scheduled) {
    if (sp.isImpossible || !Number.isFinite(sp.endMonths)) {
      impossible += 1;
      continue;
    }
    sumEndMonths += sp.endMonths;
    // Over the finite ends only: an impossible project is already counted in
    // its own tier, and letting Infinity in here would flatten every horizon
    // comparison into a tie.
    if (sp.endMonths > horizonMonths) horizonMonths = sp.endMonths;
    const deadline = deadlineMonths[sp.project.id];
    if (deadline !== undefined && sp.endMonths > deadline + EPS) missedDeadlines += 1;
  }
  return { impossible, missedDeadlines, horizonMonths, sumEndMonths };
}

/** < 0 when `a` is the better plan. Integer tiers compare exactly; months
 *  differences inside EPS are a tie. */
export function compareScores(a: PlanScore, b: PlanScore): number {
  if (a.impossible !== b.impossible) return a.impossible - b.impossible;
  if (a.missedDeadlines !== b.missedDeadlines) return a.missedDeadlines - b.missedDeadlines;
  const h = a.horizonMonths - b.horizonMonths;
  if (Math.abs(h) > EPS) return h;
  const d = a.sumEndMonths - b.sumEndMonths;
  return Math.abs(d) <= EPS ? 0 : d;
}

/** Base pools plus a scenario's hires. Never rounds — the caller owns the
 *  write boundary, exactly as the variant editor does. */
export function poolsWith(
  base: CapabilityVector,
  hires: Partial<Record<Capability, number>>,
): CapabilityVector {
  const out = { ...base };
  for (const capability of CAPABILITY_ORDER) {
    const n = hires[capability] ?? 0;
    if (n) out[capability] = (out[capability] ?? 0) + n * HIRE_STEP;
  }
  return out;
}

interface Node {
  counts: Partial<Record<Capability, number>>;
  pools: CapabilityVector;
  score: PlanScore;
}

/** Multiset identity: two hiring orders that end in the same team are the same
 *  scenario, and simulating both is pure waste. */
function keyOf(counts: Partial<Record<Capability, number>>): string {
  return CAPABILITY_ORDER.map((c) => counts[c] ?? 0).join(",");
}

export interface PlanState {
  readonly input: HiringPlanInput;
  readonly base: CapabilityVector;
  readonly caps: CapabilityCaps;
  readonly maxHires: number;
  /** Capabilities worth hiring into at all, with their reasons recorded. */
  readonly candidates: Capability[];
  readonly blocked: BlockedHire[];
  baseNode: Node;
  /** Hires represented by the current beam. */
  level: number;
  beam: Node[];
  /** Pending expansions for the level being built. */
  pending: Partial<Record<Capability, number>>[];
  /** Evaluated expansions for the level being built. */
  evaluated: Node[];
  seen: Set<string>;
  best: Node[];
  simulations: number;
  done: boolean;
}

function simulate(state: PlanState, pools: CapabilityVector): PlanScore {
  const { deadlineMonths: _d, caps: _c, maxHires: _m, ...simInput } = state.input;
  const schedule = simulateCapabilitySchedule({ ...simInput, pools });
  state.simulations += 1;
  return scoreOf(schedule, state.input.deadlineMonths);
}

export function createPlan(base: CapabilityVector, input: HiringPlanInput): PlanState {
  const caps = input.caps ?? {};
  const maxHires = Math.max(1, Math.min(MAX_HIRES, input.maxHires ?? MAX_HIRES));
  const demand = totalCapabilityEffortDays(input.projects, input.cells);

  const candidates: Capability[] = [];
  const blocked: BlockedHire[] = [];
  for (const capability of CAPABILITY_ORDER) {
    // Hiring into a capability the portfolio never asks for cannot change a
    // single date, so it is pruned rather than simulated seven times over.
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

  const state: PlanState = {
    input,
    base,
    caps,
    maxHires,
    candidates,
    blocked,
    baseNode: {
      counts: {},
      pools: base,
      score: { impossible: 0, missedDeadlines: 0, horizonMonths: 0, sumEndMonths: 0 },
    },
    level: 0,
    beam: [],
    pending: [],
    evaluated: [],
    seen: new Set(),
    best: [],
    simulations: 0,
    done: false,
  };

  state.baseNode = { counts: {}, pools: base, score: simulate(state, base) };
  state.beam = [state.baseNode];
  state.pending = expansionsOf(state, state.beam);
  state.done = state.pending.length === 0;
  return state;
}

/** Every one-hire extension of the current beam that clears its cap and has
 *  not been seen at any earlier level. */
function expansionsOf(state: PlanState, beam: Node[]): Partial<Record<Capability, number>>[] {
  const out: Partial<Record<Capability, number>>[] = [];
  for (const node of beam) {
    for (const capability of state.candidates) {
      const next = { ...node.counts, [capability]: (node.counts[capability] ?? 0) + 1 };
      const cap = state.caps[capability];
      if (cap !== undefined) {
        const total = (state.base[capability] ?? 0) + (next[capability] ?? 0) * HIRE_STEP;
        if (total > cap + EPS) continue;
      }
      const key = keyOf(next);
      if (state.seen.has(key)) continue;
      state.seen.add(key);
      out.push(next);
    }
  }
  return out;
}

/** One tick: up to SIMS_PER_STEP simulations. Returns true when the whole plan
 *  is finished. Mirrors the ceiling autopilot's contract so the hook driving it
 *  is the same shape. */
export function stepPlan(state: PlanState): boolean {
  if (state.done) return true;

  let budget = SIMS_PER_STEP;
  while (budget > 0 && state.pending.length > 0) {
    const counts = state.pending.shift()!;
    const pools = poolsWith(state.base, counts);
    state.evaluated.push({ counts, pools, score: simulate(state, pools) });
    budget -= 1;
  }

  if (state.pending.length > 0) return false;

  // Level complete: keep the best split as this level's answer, and carry the
  // best few forward as the seeds for the next hire.
  state.level += 1;
  if (state.evaluated.length === 0) {
    state.done = true;
    return true;
  }
  const ranked = state.evaluated.slice().sort((a, b) => compareScores(a.score, b.score));
  state.best.push(ranked[0]);
  state.beam = ranked.slice(0, BEAM_WIDTH);
  state.evaluated = [];

  if (state.level >= state.maxHires) {
    state.done = true;
    return true;
  }
  state.pending = expansionsOf(state, state.beam);
  if (state.pending.length === 0) state.done = true;
  return state.done;
}

/** Sugar for tests and any caller happy to block: run to completion. */
export function runPlan(base: CapabilityVector, input: HiringPlanInput): HiringPlanResult {
  const state = createPlan(base, input);
  while (!stepPlan(state)) {
    /* keep stepping */
  }
  return planResult(state);
}

export function planResult(state: PlanState): HiringPlanResult {
  const base = state.baseNode;
  const scenarios: HiringScenario[] = state.best.map((node, index) => {
    const previous = index > 0 ? state.best[index - 1] : base;
    return {
      hires: index + 1,
      byCapability: { ...node.counts },
      pools: node.pools,
      score: node.score,
      horizonMonths: node.score.horizonMonths,
      deltaImpossible: node.score.impossible - base.score.impossible,
      deltaMissed: node.score.missedDeadlines - base.score.missedDeadlines,
      deltaSumEnds: node.score.sumEndMonths - base.score.sumEndMonths,
      deltaHorizon: node.score.horizonMonths - base.score.horizonMonths,
      addedCapability: addedOver(previous.counts, node.counts),
    };
  });
  return {
    base: { pools: base.pools, score: base.score, horizonMonths: base.score.horizonMonths },
    scenarios,
    blocked: state.blocked,
    simulations: state.simulations,
  };
}

/** The single capability `next` adds over `previous`, when it adds exactly one
 *  and takes nothing away. Undefined when the split was reshuffled instead of
 *  extended — the honest answer there is "this is a different team", not "and
 *  then hire an X". */
function addedOver(
  previous: Partial<Record<Capability, number>>,
  next: Partial<Record<Capability, number>>,
): Capability | undefined {
  let added: Capability | undefined;
  let diffs = 0;
  for (const capability of CAPABILITY_ORDER) {
    const delta = (next[capability] ?? 0) - (previous[capability] ?? 0);
    if (delta === 0) continue;
    if (delta !== 1) return undefined;
    diffs += 1;
    added = capability;
  }
  return diffs === 1 ? added : undefined;
}
