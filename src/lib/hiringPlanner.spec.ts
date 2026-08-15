import { describe, expect, it } from "vitest";
import type { Capability, CapabilityCell, CapabilityVector, Project } from "../types";
import {
  CAPABILITY_ORDER,
  DEFAULT_ESTIMATION_SETTINGS,
  DEFAULT_PERSON_FOCUS_FACTOR,
  emptyCapabilityVector,
} from "./estimation";
import {
  MAX_HIRES,
  compareScores,
  createPlan,
  planResult,
  poolsWith,
  runPlan,
  stepPlan,
  type HiringPlanInput,
  type HiringPlanResult,
} from "./hiringPlanner";

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

function hiresIn(result: HiringPlanResult, n: number): Partial<Record<Capability, number>> {
  return result.scenarios.find((s) => s.hires === n)?.byCapability ?? {};
}

/** Invariants every result must hold, whatever the fixture. */
function expectInvariants(result: HiringPlanResult, caps: Record<string, number> = {}): void {
  expect(result.scenarios.length).toBeLessThanOrEqual(MAX_HIRES);
  result.scenarios.forEach((scenario, index) => {
    // Ascending, gapless, and the split really does hire what it claims.
    expect(scenario.hires).toBe(index + 1);
    const total = CAPABILITY_ORDER.reduce((sum, c) => sum + (scenario.byCapability[c] ?? 0), 0);
    expect(total).toBe(scenario.hires);
    for (const capability of CAPABILITY_ORDER) {
      const n = scenario.byCapability[capability] ?? 0;
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      // Never proposes letting anyone go.
      expect(scenario.pools[capability]).toBeGreaterThanOrEqual(result.base.pools[capability] - 1e-9);
      const cap = caps[capability];
      if (cap !== undefined) expect(scenario.pools[capability]).toBeLessThanOrEqual(cap + 1e-9);
    }
    // More people never makes the plan worse than the plan without them...
    expect(compareScores(scenario.score, result.base.score)).toBeLessThanOrEqual(0);
    // ...nor worse than the plan with one fewer, on the full ranking. Compared
    // on the raw horizon this would be wrong, because an all-impossible plan
    // has a horizon of 0 — "nothing finishes", not "finishes instantly" — and
    // the impossible tier is what separates those two.
    if (index > 0) {
      const previous = result.scenarios[index - 1];
      expect(compareScores(scenario.score, previous.score)).toBeLessThanOrEqual(0);
    }
  });
}

describe("hiringPlanner", () => {
  it("hires into the capability that is actually starving the plan", () => {
    // BE has thirty times the work of anyone else and one person to do it.
    // The ceiling stays at 2 so the crew's minimum still clears the pool of 1 —
    // at 3 the project would be impossible instead of merely slow, and the
    // first hire would be healing it rather than speeding it up.
    const projects = [project("a")];
    const cells = cellsFor({
      a: { BE: { days: 600, maxFte: 2 }, QA: { days: 20, maxFte: 2 } },
    });
    const result = runPlan(pools({ BE: 1, QA: 2 }), input(projects, cells));

    expectInvariants(result);
    expect(hiresIn(result, 1)).toEqual({ BE: 1 });
    expect(result.scenarios[0].deltaSumEnds).toBeLessThan(0);
  });

  it("respects a cap, and says which capability it froze", () => {
    const projects = [project("a")];
    const cells = cellsFor({
      a: { TL: { days: 400, maxFte: 3 }, BE: { days: 100, maxFte: 3 } },
    });
    // TL is where the work is, but the team may only ever have one.
    const caps = { TL: 1 };
    const result = runPlan(pools({ TL: 1, BE: 1 }), input(projects, cells, { caps, maxHires: 3 }));

    expectInvariants(result, caps);
    for (const scenario of result.scenarios) {
      expect(scenario.byCapability.TL ?? 0).toBe(0);
      expect(scenario.pools.TL).toBe(1);
    }
    expect(result.blocked).toContainEqual({ capability: "TL", reason: "cap", cap: 1, pool: 1 });
  });

  it("caps count the existing pool, not just the hires", () => {
    const projects = [project("a")];
    const cells = cellsFor({ a: { BE: { days: 400, maxFte: 3 } } });
    // Pool is already 2; a cap of 3 leaves room for exactly one hire.
    const result = runPlan(pools({ BE: 2 }), input(projects, cells, { caps: { BE: 3 }, maxHires: 4 }));

    expectInvariants(result, { BE: 3 });
    for (const scenario of result.scenarios) expect(scenario.pools.BE).toBeLessThanOrEqual(3);
    expect(hiresIn(result, 1)).toEqual({ BE: 1 });
  });

  it("stops early when every capability is capped out", () => {
    const projects = [project("a")];
    const cells = cellsFor({ a: { BE: { days: 200, maxFte: 2 }, QA: { days: 50, maxFte: 2 } } });
    const caps = { BE: 1, QA: 1 };
    const result = runPlan(pools({ BE: 1, QA: 1 }), input(projects, cells, { caps }));

    expect(result.scenarios).toHaveLength(0);
    expect(result.blocked.filter((b) => b.reason === "cap")).toHaveLength(2);
  });

  it("never hires into a capability the portfolio has no work for", () => {
    const projects = [project("a")];
    const cells = cellsFor({ a: { BE: { days: 300, maxFte: 3 } } });
    const result = runPlan(pools({ BE: 1, SEC: 1 }), input(projects, cells, { maxHires: 3 }));

    expectInvariants(result);
    for (const scenario of result.scenarios) {
      for (const capability of CAPABILITY_ORDER) {
        if (capability !== "BE") expect(scenario.byCapability[capability] ?? 0).toBe(0);
      }
    }
    expect(result.blocked.some((b) => b.capability === "SEC" && b.reason === "no-demand")).toBe(true);
  });

  it("spreads hires when two capabilities each hold their own phase", () => {
    // UX gates faza 1 and BE gates faza 2; one hire cannot fix both.
    const projects = [project("a")];
    const cells = cellsFor({
      a: { UX: { days: 300, maxFte: 3 }, BE: { days: 300, maxFte: 3 } },
    });
    const result = runPlan(pools({ UX: 1, BE: 1 }), input(projects, cells, { maxHires: 2 }));

    expectInvariants(result);
    const two = hiresIn(result, 2);
    expect(two.UX).toBe(1);
    expect(two.BE).toBe(1);
  });

  it("reports the added capability so the list reads as a hiring order", () => {
    const projects = [project("a")];
    const cells = cellsFor({
      a: { BE: { days: 600, maxFte: 3 }, FE: { days: 200, maxFte: 3 } },
    });
    const result = runPlan(pools({ BE: 1, FE: 1 }), input(projects, cells, { maxHires: 3 }));

    expectInvariants(result);
    // Every step here is a strict extension of the one before it.
    for (const scenario of result.scenarios) expect(scenario.addedCapability).toBeDefined();
  });

  it("prefers healing an impossible project over shortening a possible one", () => {
    // b can never run: nobody does SEC at all. a merely runs slowly.
    const projects = [project("a"), project("b")];
    const cells = cellsFor({
      a: { BE: { days: 400, maxFte: 3 } },
      b: { SEC: { days: 20, maxFte: 1 } },
    });
    const result = runPlan(pools({ BE: 1, SEC: 0 }), input(projects, cells, { maxHires: 1 }));

    expect(hiresIn(result, 1)).toEqual({ SEC: 1 });
    expect(result.scenarios[0].deltaImpossible).toBe(-1);
  });

  it("counts missed deadlines but never lets them steer a hire", () => {
    const projects = [project("a"), project("b")];
    const cells = cellsFor({
      // b is small and due soon; a is big and unconstrained. A second tester
      // would rescue b's deadline, but deadlines are soft markers — the plan's
      // length decides, so the hire goes where the months are.
      a: { BE: { days: 600, maxFte: 2 } },
      b: { QA: { days: 60, maxFte: 2 } },
    });
    const withoutDeadline = runPlan(
      pools({ BE: 1, QA: 1 }),
      input(projects, cells, { maxHires: 1 }),
    );
    const withDeadline = runPlan(
      pools({ BE: 1, QA: 1 }),
      input(projects, cells, { maxHires: 1, deadlineMonths: { b: 3 } }),
    );

    // The marker changes what is reported, never what is chosen.
    expect(hiresIn(withDeadline, 1)).toEqual(hiresIn(withoutDeadline, 1));
    expect(hiresIn(withDeadline, 1)).toEqual({ BE: 1 });
    expect(withDeadline.base.score.missedDeadlines).toBe(1);
    expect(withoutDeadline.base.score.missedDeadlines).toBe(0);
  });

  it("does not mutate the pools it was given", () => {
    const projects = [project("a")];
    const cells = cellsFor({ a: { BE: { days: 300, maxFte: 3 } } });
    const base = pools({ BE: 1 });
    const snapshot = { ...base };
    runPlan(base, input(projects, cells, { maxHires: 3 }));
    expect(base).toEqual(snapshot);
  });

  it("re-simulating a scenario's pools reproduces its score", () => {
    const projects = [project("a"), project("b")];
    const cells = cellsFor({
      a: { BE: { days: 400, maxFte: 3 }, QA: { days: 40, maxFte: 2 } },
      b: { FE: { days: 200, maxFte: 2 } },
    });
    const base = pools({ BE: 1, QA: 1, FE: 1 });
    const result = runPlan(base, input(projects, cells, { maxHires: 2 }));

    for (const scenario of result.scenarios) {
      expect(poolsWith(base, scenario.byCapability)).toEqual(scenario.pools);
      const rerun = runPlan(scenario.pools, input(projects, cells, { maxHires: 1 }));
      expect(rerun.base.score.sumEndMonths).toBeCloseTo(scenario.score.sumEndMonths, 6);
    }
  });

  it("steps to the same answer the blocking helper returns", () => {
    const projects = [project("a")];
    const cells = cellsFor({ a: { BE: { days: 400, maxFte: 3 }, FE: { days: 90, maxFte: 2 } } });
    const base = pools({ BE: 1, FE: 1 });
    const i = input(projects, cells, { maxHires: 3 });

    const state = createPlan(base, i);
    let ticks = 0;
    while (!stepPlan(state)) {
      ticks += 1;
      expect(ticks).toBeLessThan(500); // termination guard
    }
    expect(planResult(state)).toEqual(runPlan(base, i));
  });
});
