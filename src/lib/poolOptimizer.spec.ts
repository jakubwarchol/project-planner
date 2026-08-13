import { describe, expect, it } from "vitest";
import type { Capability, CapabilityCell, CapabilityVector, Project } from "../types";
import {
  CAPABILITY_ORDER,
  DEFAULT_ESTIMATION_SETTINGS,
  DEFAULT_PERSON_FOCUS_FACTOR,
  emptyCapabilityVector,
} from "./estimation";
import {
  MAX_MOVES,
  QUARTER,
  compareScores,
  composeVector,
  createSearch,
  floorDiagnostic,
  scoreOf,
  searchResult,
  stepSearch,
  type PlanScore,
  type PoolMove,
  type PoolOptimizerResult,
  type PoolSearchInput,
} from "./poolOptimizer";
import { simulateCapabilitySchedule } from "./scheduling";

const EDPM = DEFAULT_ESTIMATION_SETTINGS.workingDaysPerMonth * DEFAULT_PERSON_FOCUS_FACTOR;

function uniformRate(days: number): CapabilityVector {
  const rate = emptyCapabilityVector();
  for (const capability of CAPABILITY_ORDER) rate[capability] = days;
  return rate;
}
const RATE = uniformRate(EDPM);

function project(id: string): Project {
  return { id, name: id, category: "Projekty", estimate: "M" };
}

function cellsFor(
  rows: Record<string, Partial<Record<Capability, { days: number; maxFte: number }>>>,
): Record<string, Record<Capability, CapabilityCell>> {
  const out: Record<string, Record<Capability, CapabilityCell>> = {};
  for (const [projectId, row] of Object.entries(rows)) {
    const full = {} as Record<Capability, CapabilityCell>;
    for (const capability of CAPABILITY_ORDER) {
      const cell = row[capability];
      full[capability] = { days: cell?.days ?? 0, maxFte: cell?.maxFte ?? 0 };
    }
    out[projectId] = full;
  }
  return out;
}

function pools(overrides: Partial<CapabilityVector>): CapabilityVector {
  return { ...emptyCapabilityVector(), ...overrides };
}

function input(
  projects: Project[],
  cells: ReturnType<typeof cellsFor>,
  deadlineMonths: Record<string, number> = {},
  minStaffingFraction = DEFAULT_ESTIMATION_SETTINGS.minStaffingFraction,
): PoolSearchInput {
  return {
    projects,
    cells,
    effectiveDaysPerMonth: RATE,
    minStaffingFraction,
    minCrewFte: DEFAULT_ESTIMATION_SETTINGS.minCrewFte,
    earliestStart: {},
    deadlineMonths,
  };
}

// The production path, exactly as the UI will drive it: usePoolProposal steps
// createSearch/stepSearch to completion and reads searchResult.
function runSearch(p: CapabilityVector, i: PoolSearchInput): PoolOptimizerResult {
  const search = createSearch(p, i);
  while (!stepSearch(search)) {
    /* run to completion */
  }
  return searchResult(search);
}

function sumOf(vector: CapabilityVector): number {
  return CAPABILITY_ORDER.reduce((sum, capability) => sum + vector[capability], 0);
}

/** Invariants every result must hold, whatever the fixture. */
function expectInvariants(result: PoolOptimizerResult): void {
  expect(sumOf(result.poolsAfter)).toBeCloseTo(sumOf(result.poolsBefore), 6);
  for (const move of result.moves) {
    expect(move.fte).toBeGreaterThan(0);
    expect(Math.abs(move.fte * 4 - Math.round(move.fte * 4))).toBeLessThan(1e-9);
  }
  for (const capability of CAPABILITY_ORDER) {
    expect(result.poolsAfter[capability]).toBeGreaterThanOrEqual(-1e-9);
  }
  expect(result.moves.length).toBeLessThanOrEqual(MAX_MOVES);
}

describe("the pool search", () => {
  it("moves an idle pool onto the starving one, consolidated into one move", () => {
    // BE is pool-limited under a ceiling of 2 while a whole QA sits on zero
    // demand. The full 1.0 transfer must arrive as a single thick move, not
    // four quarter lines.
    const i = input([project("p1")], cellsFor({ p1: { BE: { days: 120, maxFte: 2 } } }));
    const result = runSearch(pools({ BE: 1, QA: 1 }), i);

    expectInvariants(result);
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0]).toMatchObject({ from: "QA", to: "BE", fte: 1 });
    expect(result.scoreAfter.sumEndMonths).toBeLessThan(result.scoreBefore.sumEndMonths);
    expect(result.poolsAfter.BE).toBeCloseTo(2, 6);
    expect(result.poolsAfter.QA).toBeCloseTo(0, 6);
  });

  it("refuses a move that improves the sum of ends but breaks a deadline", () => {
    // Draining BE into FE would finish the portfolio sooner on aggregate, but
    // p1 holds its deadline by a tenth of a month — the deadline tier vetoes.
    const cells = cellsFor({
      p1: { BE: { days: 60, maxFte: 2 } },
      p2: { FE: { days: 240, maxFte: 3 } },
    });
    const p1End = 60 / (2 * EDPM);
    const i = input([project("p1"), project("p2")], cells, { p1: p1End + 0.1 });
    const result = runSearch(pools({ BE: 2, FE: 2 }), i);

    expectInvariants(result);
    expect(result.moves).toEqual([]);
    const vetoed = result.blocked.find(
      (b) => b.from === "BE" && b.to === "FE" && b.reason === "worse",
    );
    expect(vetoed).toBeDefined();
    expect(vetoed?.deltaMissed).toBe(1);
    // The sum would have improved — that is exactly what makes the veto a
    // statement about tier order rather than about the move being useless.
    expect(vetoed?.deltaSumEnds).toBeLessThan(0);
  });

  it("finds nothing to move on a single-pool portfolio", () => {
    const i = input([project("p1")], cellsFor({ p1: { BE: { days: 120, maxFte: 2 } } }));
    const result = runSearch(pools({ BE: 2, QA: 0.1 }), i);

    expectInvariants(result);
    expect(result.moves).toEqual([]);
    expect(compareScores(result.scoreAfter, result.scoreBefore)).toBe(0);
    expect(result.blocked.some((b) => b.from === "QA" && b.reason === "pool")).toBe(true);
  });

  it("rejects a donation that would push the donor's own project off a cliff", () => {
    // BE has slack above p2's ceiling, so feeding UX is free — but draining
    // UX back below p1's minimum crew would make p1 impossible, and that
    // direction must be reported, never proposed.
    const cells = cellsFor({
      p1: { UX: { days: 40, maxFte: 1 } },
      p2: { BE: { days: 240, maxFte: 2 } },
    });
    const i = input([project("p1"), project("p2")], cells, {}, 0.5);
    const before = pools({ UX: 0.6, BE: 3 });
    const result = runSearch(before, i);

    expectInvariants(result);
    expect(result.moves.length).toBeGreaterThan(0);
    expect(result.moves[0]).toMatchObject({ from: "BE", to: "UX" });
    expect(result.blocked.some((b) => b.reason === "impossible")).toBe(true);
    // Applying the proposal leaves every project schedulable.
    const after = simulateCapabilitySchedule({
      ...i,
      pools: composeVector(before, result.moves),
    });
    expect(after.scheduled.some((p) => p.isImpossible)).toBe(false);
    // The search never mutates what it was given.
    expect(before.UX).toBe(0.6);
    expect(before.BE).toBe(3);
  });

  it("heals a pre-existing impossible project with the coarse rescue step", () => {
    // SEC has no pool at all, so p1 is impossible at baseline. A quarter into
    // SEC still sits under its minimum crew — only the 1.0 rescue step clears
    // the cliff, and healing outranks every other consideration.
    const cells = cellsFor({
      p1: { SEC: { days: 20, maxFte: 1 } },
      p2: { BE: { days: 120, maxFte: 2 } },
    });
    const i = input([project("p1"), project("p2")], cells, {}, 0.5);
    const result = runSearch(pools({ SEC: 0, BE: 2 }), i);

    expectInvariants(result);
    expect(result.scoreBefore.impossible).toBe(1);
    expect(result.scoreAfter.impossible).toBe(0);
    expect(result.moves[0]).toMatchObject({ from: "BE", to: "SEC", fte: 1 });
  });

  it("terminates within its budgets on a plan where every move helps", () => {
    const cells = cellsFor({
      p1: { BE: { days: 200, maxFte: 3 } },
      p2: { FE: { days: 200, maxFte: 3 } },
    });
    const result = runSearch(pools({ BE: 1, FE: 1, QA: 6 }), input([project("p1"), project("p2")], cells));

    expectInvariants(result);
    expect(result.moves.length).toBeLessThanOrEqual(MAX_MOVES);
    expect(result.simulations).toBeLessThan(600);
    for (const move of result.moves) {
      expect(move.to === "BE" || move.to === "FE").toBe(true);
    }
  });
});

describe("scoring", () => {
  it("treats an end exactly on the deadline as met, and just past it as missed", () => {
    const cells = cellsFor({ p1: { BE: { days: 120, maxFte: 2 } } });
    const i = input([project("p1")], cells);
    const schedule = simulateCapabilitySchedule({ ...i, pools: pools({ BE: 2 }) });
    const end = 120 / (2 * EDPM);

    expect(scoreOf(schedule, { p1: end }).missedDeadlines).toBe(0);
    expect(scoreOf(schedule, { p1: end - 0.01 }).missedDeadlines).toBe(1);
    expect(scoreOf(schedule, {}).missedDeadlines).toBe(0);
    expect(scoreOf(schedule, {}).sumEndMonths).toBeCloseTo(end, 6);
  });

  it("counts an impossible project once, in its own tier, never in the sums", () => {
    const cells = cellsFor({ p1: { BE: { days: 120, maxFte: 2 } } });
    const i = input([project("p1")], cells, { p1: 1 });
    const schedule = simulateCapabilitySchedule({ ...i, pools: pools({ BE: 0 }) });
    const score = scoreOf(schedule, i.deadlineMonths);

    expect(score.impossible).toBe(1);
    expect(score.missedDeadlines).toBe(0);
    expect(score.sumEndMonths).toBe(0);
  });

  it("compares lexicographically", () => {
    const s = (impossible: number, missed: number, sum: number): PlanScore => ({
      impossible,
      missedDeadlines: missed,
      sumEndMonths: sum,
    });
    expect(compareScores(s(0, 5, 100), s(1, 0, 1))).toBeLessThan(0);
    expect(compareScores(s(0, 1, 100), s(0, 2, 1))).toBeLessThan(0);
    expect(compareScores(s(0, 0, 10), s(0, 0, 12))).toBeLessThan(0);
    expect(compareScores(s(0, 0, 10), s(0, 0, 10 + 1e-9))).toBe(0);
  });
});

describe("composing the proposed vector", () => {
  it("reproduces exactly the pools and score the search previewed", () => {
    const i = input([project("p1")], cellsFor({ p1: { BE: { days: 120, maxFte: 2 } } }));
    const before = pools({ BE: 1, QA: 1 });
    const result = runSearch(before, i);

    const composed = composeVector(before, result.moves);
    for (const capability of CAPABILITY_ORDER) {
      expect(composed[capability]).toBeCloseTo(result.poolsAfter[capability], 10);
    }
    const replayed = scoreOf(
      simulateCapabilitySchedule({ ...i, pools: composed }),
      i.deadlineMonths,
    );
    expect(replayed.sumEndMonths).toBeCloseTo(result.scoreAfter.sumEndMonths, 6);
    expect(replayed.missedDeadlines).toBe(result.scoreAfter.missedDeadlines);
  });

  it("honours a subset — an unticked move is left out, not approximated", () => {
    const score: PlanScore = { impossible: 0, missedDeadlines: 0, sumEndMonths: 0 };
    const move = (from: Capability, to: Capability, fte: number): PoolMove => ({
      from,
      to,
      fte,
      scoreAfter: score,
      deltaMissed: 0,
      deltaSumEnds: 0,
      poolFromAfter: 0,
      poolToAfter: 0,
    });
    const base = pools({ BE: 2, QA: 1, FE: 1 });
    const subset = composeVector(base, [move("QA", "BE", 0.5), move("FE", "BE", 0.5)], new Set([0]));

    expect(subset.BE).toBeCloseTo(2.5, 10);
    expect(subset.QA).toBeCloseTo(0.5, 10);
    expect(subset.FE).toBeCloseTo(1, 10);
  });
});

describe("the reports", () => {
  it("prices +1.0 FTE per capability against the post-move vector", () => {
    const i = input([project("p1")], cellsFor({ p1: { BE: { days: 120, maxFte: 2 } } }));
    const result = runSearch(pools({ BE: 1, QA: 1 }), i);

    expect(result.hiring.map((h) => h.capability)).toEqual([...CAPABILITY_ORDER]);
    for (const entry of result.hiring) {
      expect(Number.isFinite(entry.score.sumEndMonths)).toBe(true);
      // Nothing here can gain from hiring: after the moves BE sits at its
      // ceiling, so every entry honestly reports no deadline change.
      expect(entry.deltaMissed).toBe(0);
    }
  });

  it("reports a pace-setting cell whose ceiling, not pool, binds the plan", () => {
    const i = input([project("p1")], cellsFor({ p1: { BE: { days: 120, maxFte: 1 } } }));
    const result = runSearch(pools({ BE: 3 }), i);

    const binding = result.ceilings.find((c) => c.projectId === "p1" && c.capability === "BE");
    expect(binding).toBeDefined();
    expect(binding).toMatchObject({ maxFte: 1, pool: 3, ceilingBound: true });
    const keys = result.ceilings.map((c) => `${c.projectId}:${c.capability}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("computes both floors by hand-checkable arithmetic", () => {
    const i = input(
      [project("p1")],
      cellsFor({ p1: { BE: { days: 80, maxFte: 2 }, FE: { days: 60, maxFte: 1 } } }),
    );
    const floor = floorDiagnostic(i, pools({ BE: 2, FE: 1 }));

    expect(floor.perCapabilityMonths).toBeCloseTo(60 / EDPM, 6);
    expect(floor.binding).toBe("FE");
    expect(floor.fungibleMonths).toBeCloseTo(140 / EDPM / 3, 6);

    const result = runSearch(pools({ BE: 2, FE: 1 }), i);
    expect(result.floorAfter.fungibleMonths).toBeCloseTo(result.floorBefore.fungibleMonths, 9);
  });

  it("lists per-project deltas for every project, with missed flags", () => {
    const cells = cellsFor({
      p1: { BE: { days: 120, maxFte: 2 } },
      p2: { FE: { days: 60, maxFte: 1 } },
    });
    const i = input([project("p1"), project("p2")], cells);
    const result = runSearch(pools({ BE: 1, FE: 1, QA: 1 }), i);

    expect(result.projectDeltas).toHaveLength(2);
    for (const delta of result.projectDeltas) {
      expect(Number.isNaN(delta.delta)).toBe(false);
    }
    const p1 = result.projectDeltas.find((d) => d.projectId === "p1");
    expect(p1 && p1.after <= p1.before).toBe(true);
  });
});

describe("quantization", () => {
  it("every proposed move is a positive multiple of a quarter", () => {
    const cells = cellsFor({
      p1: { BE: { days: 200, maxFte: 3 } },
      p2: { FE: { days: 200, maxFte: 3 } },
    });
    const result = runSearch(pools({ BE: 1, FE: 1, QA: 6 }), input([project("p1"), project("p2")], cells));
    for (const move of result.moves) {
      expect(move.fte).toBeGreaterThanOrEqual(QUARTER);
      expect(Math.abs(move.fte * 4 - Math.round(move.fte * 4))).toBeLessThan(1e-9);
    }
  });
});
