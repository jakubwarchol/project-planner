import { describe, expect, it } from "vitest";
import type { Capability, CapabilityCell, CapabilityVector, Project } from "../types";
import {
  CAPABILITY_ORDER,
  DEFAULT_ESTIMATION_SETTINGS,
  DEFAULT_PERSON_FOCUS_FACTOR,
  emptyCapabilityVector,
} from "./estimation";
import {
  createLadder,
  ladderResult,
  runLadder,
  stepLadder,
  type LadderResult,
} from "./hirePlusCeilings";
import { compareScores, NEVER_RAISE_CEILING } from "./planRules";
import type { HiringPlanInput } from "./hiringPlanner";

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
  extra: Partial<HiringPlanInput> = {},
): HiringPlanInput {
  return {
    projects,
    cells,
    effectiveDaysPerMonth: RATE,
    minStaffingFraction: DEFAULT_ESTIMATION_SETTINGS.minStaffingFraction,
    minCrewFte: DEFAULT_ESTIMATION_SETTINGS.minCrewFte,
    earliestStart: {},
    deadlineMonths: {},
    ...extra,
  };
}

/** Invariants every ladder must hold, whatever the fixture. */
function expectInvariants(result: LadderResult): void {
  expect(result.rungs.length).toBeGreaterThan(0);
  expect(result.rungs[0].hires).toBe(0);
  result.rungs.forEach((rung, index) => {
    expect(rung.hires).toBe(index);
    const total = CAPABILITY_ORDER.reduce((sum, c) => sum + (rung.byCapability[c] ?? 0), 0);
    expect(total).toBe(rung.hires);
    // Never a raise on the forbidden capabilities, and never past the rules.
    for (const move of rung.ceilingMoves) {
      expect(NEVER_RAISE_CEILING.has(move.capability)).toBe(false);
      expect(move.to).toBeLessThanOrEqual(3 + 1e-9);
    }
    // A rung is never worse than the plan without its lever pulled: rung 0
    // no worse than the raw base, every later rung no worse than its parent.
    const previous = index > 0 ? result.rungs[index - 1].score : result.base.score;
    expect(compareScores(rung.score, previous)).toBeLessThanOrEqual(0);
  });
}

describe("hirePlusCeilings", () => {
  it("rung 0 re-cuts today's work before anyone is hired", () => {
    // The textbook autopilot case: BE pinned at 1 with pool to spare.
    const cells = cellsFor({ a: { BE: { days: 120, maxFte: 1 } } });
    const result = runLadder(pools({ BE: 4 }), input([project("a")], cells, { maxHires: 0 }));

    expectInvariants(result);
    expect(result.rungs).toHaveLength(1);
    expect(result.rungs[0].ceilingMoves.length).toBeGreaterThan(0);
    expect(result.rungs[0].deltaHorizon).toBeLessThan(0);
  });

  it("climbs where mode 1 goes flat: the hire only pays through the ceiling", () => {
    // One backender, ceiling 1, pool 1. A second person changes nothing while
    // the ceiling stays — mode 1 reports a flat ladder here. Together with
    // the raise the plan halves.
    const cells = cellsFor({ a: { BE: { days: 300, maxFte: 1 } } });
    const result = runLadder(pools({ BE: 1 }), input([project("a")], cells, { maxHires: 1 }));

    expectInvariants(result);
    const rung = result.rungs[1];
    expect(rung.addedCapability).toBe("BE");
    expect(rung.ceilingMoves.length).toBeGreaterThan(0);
    expect(compareScores(rung.score, result.rungs[0].score)).toBeLessThan(0);
  });

  it("the pool-blocked hint steers the hire to the capability that unblocks a raise", () => {
    // Both hires look flat on the raised cells alone: BE is the pace and its
    // ceiling binds, FE is de-rated with room to spare. Only the hint — "a
    // second BE lets the blocked 1→1.5 raise through" — separates them.
    const cells = cellsFor({
      a: { BE: { days: 300, maxFte: 1 }, FE: { days: 60, maxFte: 3 } },
    });
    const result = runLadder(
      pools({ BE: 1, FE: 1 }),
      input([project("a")], cells, { maxHires: 1 }),
    );

    expectInvariants(result);
    expect(result.rungs[1].addedCapability).toBe("BE");
    expect(result.rungs[1].deltaHorizon).toBeLessThan(0);
  });

  it("computes every rung's raises fresh from the pristine matrix", () => {
    // Rung 0 already raises this cell to its pool limit of 2. Rung 1 (one
    // more backender) must start over from the pristine 1, not from 2 —
    // accumulated raises are exactly what the design rejected.
    const cells = cellsFor({ a: { BE: { days: 300, maxFte: 1 } } });
    const result = runLadder(pools({ BE: 2 }), input([project("a")], cells, { maxHires: 1 }));

    expectInvariants(result);
    for (const rung of result.rungs) {
      if (rung.ceilingMoves.length === 0) continue;
      expect(rung.ceilingMoves[0].from).toBe(1);
    }
    // And the bigger team's set reaches further than the smaller team's.
    const reach = (r: (typeof result.rungs)[number]) =>
      Math.max(0, ...r.ceilingMoves.map((m) => m.to));
    expect(reach(result.rungs[1])).toBeGreaterThan(reach(result.rungs[0]));
  });

  it("hires the forbidden capabilities without ever raising their ceilings", () => {
    // Two UX-bound projects share one designer. A second designer runs them
    // in parallel — the team-level lever — while the per-project ceiling
    // stays untouched.
    const cells = cellsFor({
      a: { UX: { days: 120, maxFte: 1 } },
      b: { UX: { days: 120, maxFte: 1 } },
    });
    const result = runLadder(
      pools({ UX: 1 }),
      input([project("a"), project("b")], cells, { maxHires: 1 }),
    );

    expectInvariants(result);
    expect(result.rungs[1].addedCapability).toBe("UX");
    expect(result.rungs[1].deltaHorizon).toBeLessThan(0);
    expect(result.rungs.every((r) => r.ceilingMoves.length === 0)).toBe(true);
  });

  it("respects the team cap mid-ladder, not just at the start", () => {
    // Cap BE at 2 with one already employed: the first hire fits, the second
    // must go elsewhere or the ladder must stop.
    const cells = cellsFor({ a: { BE: { days: 600, maxFte: 3 } } });
    const result = runLadder(
      pools({ BE: 1 }),
      input([project("a")], cells, { caps: { BE: 2 }, maxHires: 3 }),
    );

    expectInvariants(result);
    expect(result.rungs.length).toBe(2); // rung 0 + the one hire that fits
    expect(result.rungs[1].pools.BE).toBe(2);
  });

  it("steps to the same answer the blocking helper returns", () => {
    const cells = cellsFor({
      a: { BE: { days: 300, maxFte: 1 }, FE: { days: 90, maxFte: 2 } },
    });
    const base = pools({ BE: 1, FE: 1 });
    const i = input([project("a")], cells, { maxHires: 2 });

    const state = createLadder(base, i);
    let ticks = 0;
    while (!stepLadder(state)) {
      ticks += 1;
      expect(ticks).toBeLessThan(2000); // termination guard
    }
    expect(ladderResult(state)).toEqual(runLadder(base, i));
  });

  it("does not mutate the cells or pools it was given", () => {
    const cells = cellsFor({ a: { BE: { days: 300, maxFte: 1 } } });
    const base = pools({ BE: 2 });
    const snapshot = structuredClone({ cells, base });
    runLadder(base, input([project("a")], cells, { maxHires: 2 }));
    expect({ cells, base }).toEqual(snapshot.valueOf());
  });
});
