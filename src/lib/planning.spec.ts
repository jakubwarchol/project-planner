import { describe, expect, it } from "vitest";
import type { Capability, CapabilityCell, CapabilityVector, Project } from "../types";
import {
  CAPABILITY_ORDER,
  DEFAULT_ESTIMATION_SETTINGS,
  DEFAULT_PERSON_FOCUS_FACTOR,
  emptyCapabilityVector,
} from "./estimation";
import { computeStartDrift } from "./planning";
import { simulateCapabilitySchedule } from "./scheduling";

const EDPM = DEFAULT_ESTIMATION_SETTINGS.workingDaysPerMonth * DEFAULT_PERSON_FOCUS_FACTOR;
const RATE = uniformRate(EDPM);

// The scheduler takes a per-capability rate, since productivity is set per
// person. These tests plan a uniform team, so one rate covers every
// capability — the same figure the retired global focus factor produced,
// which keeps every expectation below in its original arithmetic.
function uniformRate(days: number): CapabilityVector {
  const rate = emptyCapabilityVector();
  for (const capability of CAPABILITY_ORDER) rate[capability] = days;
  return rate;
}

const NOW = { year: 2026, month: 0 }; // "now" = 2026-01, for every test below

describe("computeStartDrift", () => {
  it("is zero when the estimated start lands exactly on the planned start", () => {
    expect(computeStartDrift(NOW, 3, "2026-04-01")).toBeCloseTo(0, 9);
  });

  it("is positive when the estimate lands later than planned", () => {
    // plannedStart = October (9 months out), estimatedStart = December (11).
    expect(computeStartDrift(NOW, 11, "2026-10-01")).toBeCloseTo(2, 9);
  });

  it("is negative when the estimate lands earlier than planned", () => {
    expect(computeStartDrift(NOW, 2, "2026-06-01")).toBeCloseTo(-3, 9);
  });

  it("is null when there is no planned start to compare against", () => {
    expect(computeStartDrift(NOW, 5, undefined)).toBeNull();
  });

  it("still computes a drift when the planned start is already in the past (e.g. earlier than earliestStart)", () => {
    // planned start was 2025-06 — 7 months before "now" — so its offset is -7.
    // An estimate landing 3 months out is 10 months later than intended.
    expect(computeStartDrift(NOW, 3, "2025-06-01")).toBeCloseTo(10, 9);
  });

  it("returns null rather than a bogus number for an unparseable planned start", () => {
    expect(computeStartDrift(NOW, 3, "not-a-month")).toBeNull();
  });
});

function project(id: string, estimate: Project["estimate"], overrides: Partial<Project> = {}): Project {
  return { id, name: id, category: "Projekty", estimate, ...overrides };
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

describe("startDrift against a real schedule", () => {
  it("stays zero when nothing contends for the project's capability", () => {
    const p = project("p", "M", { plannedStartDate: "2026-01-01" });
    const result = simulateCapabilitySchedule({
      projects: [p],
      cells: cellsFor({ p: { BE: { days: 24, maxFte: 1 } } }),
      pools: pools({ BE: 1 }),
      effectiveDaysPerMonth: RATE,
      minStaffingFraction: DEFAULT_ESTIMATION_SETTINGS.minStaffingFraction,
    });

    const sp = result.scheduled[0];
    expect(computeStartDrift(NOW, sp.startMonths, p.plannedStartDate)).toBeCloseTo(0, 6);
  });

  it("shows positive drift when a higher-priority project's sticky allocation delays the start", () => {
    // q outranks p and holds the only BE for a while; p intended to start now
    // (2026-01) but can't actually begin until q releases BE.
    const q = project("q", "L");
    const p = project("p", "M", { plannedStartDate: "2026-01-01" });
    const result = simulateCapabilitySchedule({
      projects: [q, p],
      cells: cellsFor({
        q: { BE: { days: 30, maxFte: 1 } },
        p: { BE: { days: 12, maxFte: 1 } },
      }),
      pools: pools({ BE: 1 }),
      effectiveDaysPerMonth: RATE,
      minStaffingFraction: DEFAULT_ESTIMATION_SETTINGS.minStaffingFraction,
    });

    const spP = result.scheduled[1];
    const expectedStart = 30 / EDPM; // q's whole BE demand, since BE is exclusive
    expect(spP.startMonths).toBeCloseTo(expectedStart, 6);
    const drift = computeStartDrift(NOW, spP.startMonths, p.plannedStartDate);
    expect(drift).not.toBeNull();
    expect(drift!).toBeCloseTo(expectedStart, 6);
    expect(drift!).toBeGreaterThan(0);
  });

  it("updates when the backlog order changes — reordering p first removes the drift", () => {
    const q = project("q", "L");
    const p = project("p", "M", { plannedStartDate: "2026-01-01" });
    const reordered = simulateCapabilitySchedule({
      projects: [p, q],
      cells: cellsFor({
        q: { BE: { days: 30, maxFte: 1 } },
        p: { BE: { days: 12, maxFte: 1 } },
      }),
      pools: pools({ BE: 1 }),
      effectiveDaysPerMonth: RATE,
      minStaffingFraction: DEFAULT_ESTIMATION_SETTINGS.minStaffingFraction,
    });

    const spP = reordered.scheduled[0];
    expect(spP.startMonths).toBeCloseTo(0, 6);
    expect(computeStartDrift(NOW, spP.startMonths, p.plannedStartDate)).toBeCloseTo(0, 6);
  });
});
