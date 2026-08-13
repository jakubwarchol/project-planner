import { describe, expect, it } from "vitest";
import type { Capability, CapabilityCell, CapabilityVector, Project } from "../types";
import {
  CAPABILITY_ORDER,
  DEFAULT_ESTIMATION_SETTINGS,
  DEFAULT_PERSON_FOCUS_FACTOR,
  emptyCapabilityVector,
} from "./estimation";
import {
  createSearch,
  searchResult,
  stepSearch,
  type AutopilotInput,
  type AutopilotResult,
  type CeilingMove,
} from "./autopilot";
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

function input(projects: Project[], p: Partial<CapabilityVector>): AutopilotInput {
  return {
    projects,
    pools: pools(p),
    effectiveDaysPerMonth: RATE,
    minStaffingFraction: DEFAULT_ESTIMATION_SETTINGS.minStaffingFraction,
    minCrewFte: DEFAULT_ESTIMATION_SETTINGS.minCrewFte,
    earliestStart: {},
  };
}

const horizonOf = (cells: ReturnType<typeof cellsFor>, i: AutopilotInput) =>
  simulateCapabilitySchedule({ ...i, cells }).horizonMonths;

// The production path, exactly as the UI drives it: useCeilingProposal steps
// createSearch/stepSearch to completion, and CapabilityMatrix applies each
// accepted move as an absolute maxFte write to its cell.
function runSearch(cells: ReturnType<typeof cellsFor>, i: AutopilotInput): AutopilotResult {
  const search = createSearch(cells, i);
  while (!stepSearch(search)) {
    /* run to completion */
  }
  return searchResult(search);
}

function applied(
  cells: ReturnType<typeof cellsFor>,
  moves: CeilingMove[],
): ReturnType<typeof cellsFor> {
  const next = structuredClone(cells);
  for (const move of moves) next[move.projectId][move.capability].maxFte = move.to;
  return next;
}

describe("the ceiling search", () => {
  it("raises the one ceiling holding a project back", () => {
    // BE is pinned at 1 with plenty of pool behind it — the textbook case.
    const cells = cellsFor({ p1: { BE: { days: 120, maxFte: 1 } } });
    const i = input([project("p1")], { BE: 4 });

    const result = runSearch(cells, i);
    expect(result.moves.length).toBeGreaterThan(0);
    expect(result.moves[0]).toMatchObject({ projectId: "p1", capability: "BE", from: 1, to: 1.5 });
    expect(result.horizonAfter).toBeLessThan(result.horizonBefore);
  });

  it("never proposes more people than the pool has", () => {
    // One backend in the whole company: the ceiling is already everything
    // there is, so the only honest answer is "nobody to add".
    const cells = cellsFor({ p1: { BE: { days: 120, maxFte: 1 } } });
    const result = runSearch(cells, input([project("p1")], { BE: 1 }));

    expect(result.moves).toEqual([]);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]).toMatchObject({ capability: "BE", reason: "pool", pool: 1 });
  });

  it("leaves a capability that is not setting the pace alone", () => {
    // QA has four days against BE's hundred and twenty. Raising its ceiling
    // cannot shorten anything, and the proposal should never suggest it.
    const cells = cellsFor({
      p1: { BE: { days: 120, maxFte: 1 }, QA: { days: 4, maxFte: 1 } },
    });
    const result = runSearch(cells, input([project("p1")], { BE: 4, QA: 4 }));

    expect(result.moves.length).toBeGreaterThan(0);
    expect(result.moves.every((m) => m.capability !== "QA")).toBe(true);
  });

  it("stops once the pace has moved to a capability with no room left", () => {
    // BE can grow; UX cannot. Raising BE eventually hands the pace to UX, and
    // there the search has to stop rather than keep spending moves.
    const cells = cellsFor({
      p1: { BE: { days: 120, maxFte: 1 }, UX: { days: 60, maxFte: 1 } },
    });
    const result = runSearch(cells, input([project("p1")], { BE: 4, UX: 1 }));

    expect(result.moves.every((m) => m.capability === "BE")).toBe(true);
    expect(result.blocked.some((b) => b.capability === "UX" && b.reason === "pool")).toBe(true);
  });

  it("reports a move that would make the plan worse instead of hiding it", () => {
    // Two projects competing for one pool: a bigger crew on the first needs
    // more people free at once before its phase may open, so it queues longer
    // than it builds faster. That is worth reading, not silently skipping.
    const cells = cellsFor({
      p1: { BE: { days: 60, maxFte: 1 } },
      p2: { BE: { days: 60, maxFte: 1 } },
    });
    const result = runSearch(cells, input([project("p1"), project("p2")], { BE: 1.5 }));
    const noted = [...result.moves.map((m) => m.capability), ...result.blocked.map((b) => b.capability)];
    expect(noted).toContain("BE");
    // Whatever it decided, it never left the plan worse than it found it.
    expect(result.horizonAfter).toBeLessThanOrEqual(result.horizonBefore + 1e-9);
  });

  it("never returns a proposal that makes a project impossible", () => {
    const cells = cellsFor({ p1: { BE: { days: 120, maxFte: 1 } } });
    const i = input([project("p1")], { BE: 4 });
    const result = runSearch(cells, i);
    const after = simulateCapabilitySchedule({ ...i, cells: applied(cells, result.moves) });
    expect(after.scheduled.some((p) => p.isImpossible)).toBe(false);
  });

  it("finds nothing to do when there is nothing to do", () => {
    const cells = cellsFor({ p1: { BE: { days: 0, maxFte: 0 } } });
    const result = runSearch(cells, input([project("p1")], { BE: 4 }));
    expect(result.moves).toEqual([]);
    expect(result.horizonBefore).toBe(result.horizonAfter);
  });

  it("terminates on a plan where every move helps a little", () => {
    const cells = cellsFor({
      p1: { BE: { days: 200, maxFte: 1 } },
      p2: { FE: { days: 200, maxFte: 1 } },
    });
    const result = runSearch(cells, input([project("p1"), project("p2")], { BE: 9, FE: 9 }));
    expect(result.moves.length).toBeLessThanOrEqual(12);
    expect(result.simulations).toBeLessThan(400);
  });
});

describe("applying accepted moves", () => {
  it("produces exactly the plan the proposal previewed", () => {
    const cells = cellsFor({ p1: { BE: { days: 120, maxFte: 1 } } });
    const i = input([project("p1")], { BE: 4 });
    const result = runSearch(cells, i);

    expect(horizonOf(applied(cells, result.moves), i)).toBeCloseTo(result.horizonAfter, 6);
  });

  it("never mutates the cells the search was given", () => {
    const cells = cellsFor({ p1: { BE: { days: 120, maxFte: 1 } } });
    const i = input([project("p1")], { BE: 4 });
    const result = runSearch(cells, i);
    expect(result.moves.length).toBeGreaterThan(0);
    expect(cells.p1.BE.maxFte).toBe(1);
  });

  it("accepts a subset — unticking a move is honoured, not approximated", () => {
    const cells = cellsFor({
      p1: { BE: { days: 120, maxFte: 1 } },
      p2: { FE: { days: 120, maxFte: 1 } },
    });
    const i = input([project("p1"), project("p2")], { BE: 4, FE: 4 });
    const result = runSearch(cells, i);
    const first = result.moves.filter((m) => m.projectId === "p1");
    const next = applied(cells, first);
    expect(next.p2.FE.maxFte).toBe(1);
    expect(next.p1.BE.maxFte).toBeGreaterThan(1);
  });
});

