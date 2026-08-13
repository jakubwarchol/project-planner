import { describe, expect, it } from "vitest";
import type { PlannerSnapshot } from "../db";
import {
  DEFAULT_ESTIMATION_SETTINGS,
  emptyCapabilityCells,
  emptyCapabilityVector,
} from "../lib/estimation";
import type { Leave, Person, Project, StaffingAssignment } from "../types";
import { plannerReducer } from "./plannerReducer";

function person(id: string, fte: number): Person {
  return {
    id,
    name: id,
    teamId: "ZWO",
    allocations: [{ capability: "BE", fte }],
    focusFactor: 0.7,
  };
}

const PROJECTS: Project[] = [
  { id: "p1", name: "Pierwszy", category: "Projekty", estimate: "M" },
  { id: "p2", name: "Drugi", category: "Projekty", estimate: "S" },
];

const ASSIGNMENTS: StaffingAssignment[] = [
  {
    id: "as-1",
    personId: "os-1",
    projectId: "p1",
    capability: "BE",
    startDate: "2026-01-05",
    endDate: "2026-02-01",
    fte: 1,
  },
  {
    id: "as-2",
    personId: "os-2",
    projectId: "p2",
    capability: "BE",
    startDate: "2026-01-05",
    endDate: "2026-02-01",
    fte: 0.5,
  },
];

const LEAVES: Leave[] = [
  { id: "lv-1", personId: "os-1", startDate: "2026-03-02", endDate: "2026-03-09", kind: "urlop" },
  { id: "lv-2", personId: "os-2", startDate: "2026-03-02", endDate: "2026-03-09", kind: "urlop" },
];

function snapshot(): PlannerSnapshot {
  return {
    projects: PROJECTS,
    teams: [{ id: "ZWO", label: "ZWO" }],
    people: [person("os-1", 1), person("os-2", 0.5)],
    cells: { p1: emptyCapabilityCells(), p2: emptyCapabilityCells() },
    variants: [
      {
        id: "variant-1",
        label: "Wariant 1 — obecny zespół",
        fte: { ...emptyCapabilityVector(), BE: 1.5 },
        isRosterDerived: true,
      },
    ],
    settings: DEFAULT_ESTIMATION_SETTINGS,
    assignments: ASSIGNMENTS,
    leaves: LEAVES,
  };
}

function loaded(): PlannerSnapshot {
  const state = plannerReducer(null, { type: "snapshot", snapshot: snapshot() });
  if (!state) throw new Error("snapshot action must produce a state");
  return state;
}

// The database cascades a person's assignments and leaves (and a project's
// assignments) on delete; the optimistic state has to drop the same rows, or
// they linger as ghosts until the next reload.
describe("delete cascades", () => {
  it("removePerson drops that person's assignments and leaves, keeps the rest", () => {
    const next = plannerReducer(loaded(), { type: "removePerson", id: "os-1" })!;
    expect(next.people.map((p) => p.id)).toEqual(["os-2"]);
    expect(next.assignments.map((a) => a.id)).toEqual(["as-2"]);
    expect(next.leaves.map((l) => l.id)).toEqual(["lv-2"]);
  });

  it("removeProject drops assignments referencing it, keeps the rest", () => {
    const next = plannerReducer(loaded(), { type: "removeProject", id: "p1" })!;
    expect(next.projects.map((p) => p.id)).toEqual(["p2"]);
    expect(next.assignments.map((a) => a.id)).toEqual(["as-2"]);
    expect(next.leaves).toHaveLength(2);
  });
});

// The schedule cache is keyed on the variant's `fte` object identity, so a
// roster-derived variant must keep its object across actions that don't move
// the roster — and get a fresh one the moment the roster actually changes.
describe("withDerivedVariants identity", () => {
  it("keeps the variant object when the roster is unchanged", () => {
    const state = loaded();
    const next = plannerReducer(state, {
      type: "addLeave",
      leave: { id: "lv-3", personId: "os-1", startDate: "2026-04-06", endDate: "2026-04-13", kind: "urlop" },
    })!;
    expect(next).not.toBe(state);
    expect(next.variants).toBe(state.variants);
    expect(next.variants[0].fte).toBe(state.variants[0].fte);
  });

  it("re-derives the vector when a person edit moves the pools", () => {
    const state = loaded();
    const next = plannerReducer(state, {
      type: "setPersonAllocation",
      id: "os-2",
      capability: "BE",
      fte: 1,
    })!;
    expect(next.variants[0].fte).not.toBe(state.variants[0].fte);
    expect(next.variants[0].fte.BE).toBeCloseTo(2, 10);
  });
});
