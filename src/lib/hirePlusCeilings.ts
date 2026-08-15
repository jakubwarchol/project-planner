/**
 * Hire-plus-ceilings ladder (tryb 2): "if we hired N people AND re-cut the
 * work, what does the plan look like?"
 *
 * Mode 1 (`hiringPlanner.ts`) goes flat after the first hire on a
 * ceiling-bound portfolio: the plan stops being people-bound, so new people
 * have nowhere to go. This mode pulls both levers in one proposal — each
 * rung of the ladder is a team plus the complete set of ceiling raises that
 * re-cut the work for that team.
 *
 * Structure, argued in docs/hiring-and-ceilings.md and then corrected by a
 * measurement:
 *
 * - The teams come from mode 1's beam, one per hire count. The first design
 *   interleaved a greedy width-1 hire choice with the raise loop, and on the
 *   real portfolio it degenerated: single hires are flat even on raised
 *   cells — pairs like TL+BE only pay together — so greedy picked the first
 *   capability in order seven times. Surviving flat levels is exactly what
 *   the beam is for, so the beam picks who joins; this mode's own work is
 *   everything below.
 *
 * - Raises are computed fresh from the pristine matrix at every rung, never
 *   accumulated. A raise that helped a small team can hurt a bigger one (it
 *   lifts the phase-opening threshold), and the loop can only raise — without
 *   accumulation there is nothing to un-do, and each rung is a self-contained
 *   answer: "this team plus this complete raise set". Neighbouring rungs'
 *   sets need not nest.
 *
 * - Rung 0 is a real rung: today's team, work re-cut. Careful one-step raises
 *   can genuinely shorten today's plan before anyone is hired.
 *
 * The accepted approximation: the beam optimises teams under today's
 * ceilings, so a team that is only best *with* raises can be missed. The
 * exact version — a raise loop per beam candidate — costs minutes, not
 * seconds, and the raises this mode adds on top of each beam team recover
 * the bulk of the gap.
 */
import { createSearch, stepSearch, type SearchState } from "./autopilot";
import { simulateCapabilitySchedule } from "./scheduling";
import { CAPABILITY_ORDER } from "./estimation";
import {
  createPlan,
  planResult,
  stepPlan,
  type BlockedHire,
  type HiringPlanInput,
  type HiringScenario,
  type PlanState,
} from "./hiringPlanner";
import { scoreOf, type PlanScore } from "./planRules";
import type { Capability, CapabilityCell, CapabilityVector } from "../types";

/** Raise-loop budget per rung. Small on purpose: the interesting raises are
 *  always first, this cost is paid on every rung, and every extra move is
 *  another claim a human has to check. */
export const MAX_MOVES_PER_RUNG = 6;

type Cells = Record<string, Record<Capability, CapabilityCell>>;

export interface LadderRung {
  /** People hired at this rung; 0 is today's team with the work re-cut. */
  hires: number;
  /** Hires per capability; capabilities not hired into are absent. */
  byCapability: Partial<Record<Capability, number>>;
  pools: CapabilityVector;
  /** This rung's complete raise set, fresh from the pristine matrix. Apply
   *  all of them (they chain per cell: 1→1.5, 1.5→2) to reproduce the score. */
  ceilingMoves: SearchState["moves"];
  /** The raise loop hit its per-rung budget rather than running dry. */
  raisesTruncated: boolean;
  score: PlanScore;
  horizonMonths: number;
  /** Against today's team with nothing raised; negative is the improvement. */
  deltaImpossible: number;
  deltaHorizon: number;
  deltaSumEnds: number;
  /** The hire this rung's team adds over the previous one, when the beam
   *  extended rather than reshuffled — same contract as mode 1. */
  addedCapability?: Capability;
}

export interface LadderResult {
  /** Today: base team, pristine ceilings. */
  base: { pools: CapabilityVector; score: PlanScore; horizonMonths: number };
  /** Rung 0 first, then one per hire count the beam could fill, ascending. */
  rungs: LadderRung[];
  blocked: BlockedHire[];
  simulations: number;
}

export interface LadderState {
  readonly input: HiringPlanInput;
  readonly base: CapabilityVector;
  readonly pristine: Cells;
  /** Phase 1: mode 1's beam, choosing the team for every hire count. */
  plan: PlanState;
  planDone: boolean;
  scenarios: HiringScenario[];
  blocked: BlockedHire[];
  baseScore: PlanScore;
  /** Phase 2: one fresh raise search per team; 0 is the base team. */
  rungIndex: number;
  raise: SearchState | null;
  raiseBaseSims: number;
  rungs: LadderRung[];
  simulations: number;
  done: boolean;
}

function autopilotInput(state: LadderState, pools: CapabilityVector) {
  const { deadlineMonths: _d, caps: _c, maxHires: _m, cells: _cells, ...rest } = state.input;
  return { ...rest, pools };
}

export function createLadder(base: CapabilityVector, input: HiringPlanInput): LadderState {
  return {
    input,
    base,
    pristine: input.cells,
    plan: createPlan(base, input),
    planDone: false,
    scenarios: [],
    blocked: [],
    baseScore: { impossible: 0, missedDeadlines: 0, horizonMonths: 0, sumEndMonths: 0 },
    rungIndex: 0,
    raise: null,
    raiseBaseSims: 0,
    rungs: [],
    simulations: 0,
    done: false,
  };
}

/** The team whose raise loop rung `index` runs: 0 is today's, then the beam's
 *  best split per hire count. */
function teamOf(state: LadderState, index: number): {
  byCapability: Partial<Record<Capability, number>>;
  pools: CapabilityVector;
  addedCapability?: Capability;
} {
  if (index === 0) return { byCapability: {}, pools: state.base };
  const scenario = state.scenarios[index - 1];
  return {
    byCapability: scenario.byCapability,
    pools: scenario.pools,
    addedCapability: scenario.addedCapability,
  };
}

function startRaise(state: LadderState): void {
  const team = teamOf(state, state.rungIndex);
  state.raiseBaseSims = state.simulations;
  // Fresh from the pristine matrix, per the design: each rung is its own
  // complete answer, and there are no stale raises to un-do.
  state.raise = createSearch(state.pristine, autopilotInput(state, team.pools), MAX_MOVES_PER_RUNG);
}

function finishRaise(state: LadderState): void {
  const raise = state.raise!;
  const team = teamOf(state, state.rungIndex);
  state.simulations = state.raiseBaseSims + raise.simulations;
  // A finished search's schedule is its "exact" finalization re-simulation
  // (see stepSearch), so this rung's score is display-grade as it stands.
  const score = scoreOf(raise.schedule, state.input.deadlineMonths);
  const hires = CAPABILITY_ORDER.reduce((sum, c) => sum + (team.byCapability[c] ?? 0), 0);

  state.rungs.push({
    hires,
    byCapability: { ...team.byCapability },
    pools: team.pools,
    ceilingMoves: raise.moves,
    raisesTruncated: raise.truncated,
    score,
    horizonMonths: score.horizonMonths,
    deltaImpossible: score.impossible - state.baseScore.impossible,
    deltaHorizon: score.horizonMonths - state.baseScore.horizonMonths,
    deltaSumEnds: score.sumEndMonths - state.baseScore.sumEndMonths,
    addedCapability: team.addedCapability,
  });

  state.raise = null;
  state.rungIndex += 1;
  if (state.rungIndex > state.scenarios.length) {
    state.done = true;
    return;
  }
  startRaise(state);
}

/** One tick: a slice of the beam or one raise-loop round — either way a
 *  bounded handful of simulations. Returns true when the whole ladder is
 *  finished. Same contract as `stepPlan` / `stepSearch`. */
export function stepLadder(state: LadderState): boolean {
  if (state.done) return true;

  if (!state.planDone) {
    if (stepPlan(state.plan)) {
      state.planDone = true;
      const result = planResult(state.plan);
      state.scenarios = result.scenarios;
      state.blocked = result.blocked;
      // The beam scores itself under "search" fidelity — cheap, and fair,
      // because its nodes only ever race each other. Every rung the drawer
      // shows is scored from an "exact" schedule though, and every delta on
      // it is measured against this base — so the base has to be exact too.
      state.baseScore = scoreOf(
        simulateCapabilitySchedule({ ...autopilotInput(state, state.base), cells: state.pristine }),
        state.input.deadlineMonths,
      );
      state.simulations = state.plan.simulations + 1;
      startRaise(state);
    } else {
      state.simulations = state.plan.simulations;
    }
    return false;
  }

  if (stepSearch(state.raise!)) {
    finishRaise(state);
  } else {
    state.simulations = state.raiseBaseSims + state.raise!.simulations;
  }
  return state.done;
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
