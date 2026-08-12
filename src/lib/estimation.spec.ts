import { describe, expect, it } from "vitest";
import type { Capability, Person, Project } from "../types";
import {
  DEFAULT_ESTIMATION_SETTINGS,
  DEFAULT_PERSON_FOCUS_FACTOR,
  EFFORT_DRIFT_EPSILON_DAYS,
  derivePoolsFromPeople,
  effectiveDaysByCapability,
  effortDrift,
  focusByCapability,
  personEffectiveFte,
  referenceEffortDays,
} from "./estimation";

const settings = DEFAULT_ESTIMATION_SETTINGS;

function project(estimate: Project["estimate"]): Project {
  return { id: "p", name: "p", category: "Projekty", estimate };
}

function person(
  id: string,
  focusFactor: number,
  allocations: [Capability, number][],
): Person {
  return {
    id,
    name: id,
    teamId: "ZWO",
    focusFactor,
    allocations: allocations.map(([capability, fte]) => ({ capability, fte })),
  };
}

describe("referenceEffortDays", () => {
  it("turns a T-shirt size into days via the editable scale", () => {
    // L weighs 10, at the default 6 days per point.
    expect(referenceEffortDays(project("L"), settings)).toBe(60);
    expect(referenceEffortDays(project("XXL"), settings)).toBe(186);
  });
});

describe("effortDrift", () => {
  it("treats a row that matches its size as agreeing", () => {
    const drift = effortDrift(project("L"), 60, settings);
    expect(drift).toMatchObject({ reference: 60, assigned: 60, delta: 0 });
    expect(drift.differs).toBe(false);
    expect(drift.isMaterial).toBe(false);
  });

  it("ignores the floating-point dust left by splitting a total seven ways", () => {
    // 24.000000000000004 vs 24 is the same number, not a data-quality problem.
    const drift = effortDrift(project("M"), 24.000000000000004, settings);
    expect(drift.differs).toBe(false);
    expect(drift.isMaterial).toBe(false);
  });

  it("notices a small difference while editing without calling it material", () => {
    // 3 days short of a 60-day L: visible in the matrix, not worth an alarm.
    const drift = effortDrift(project("L"), 57, settings);
    expect(drift.delta).toBe(-3);
    expect(drift.differs).toBe(true);
    expect(drift.isMaterial).toBe(false);
  });

  it("flags a difference past a tenth of the reference as material", () => {
    const drift = effortDrift(project("L"), 45, settings); // -25%
    expect(drift.delta).toBe(-15);
    expect(drift.isMaterial).toBe(true);
  });

  it("flags a row that overshoots its size, not just one that falls short", () => {
    const drift = effortDrift(project("L"), 80, settings);
    expect(drift.delta).toBe(20);
    expect(drift.isMaterial).toBe(true);
  });

  it("scales the tolerance with the project, so a big row isn't judged by a small one's yardstick", () => {
    // The same 18 days adrift is nearly a third of an L but under a tenth of
    // an XXL, so it is material for one and not the other.
    expect(effortDrift(project("L"), 42, settings).isMaterial).toBe(true);
    expect(effortDrift(project("XXL"), 168, settings).isMaterial).toBe(false);
    expect(effortDrift(project("XXL"), 146, settings).isMaterial).toBe(true);
  });

  it("keeps a floor under the tolerance so a tiny project isn't judged by percentages alone", () => {
    // 10% of an S (6 days) is 0.6, below the dust threshold — the floor wins,
    // so an S is only material once it is off by more than half a day.
    expect(effortDrift(project("S"), 6 - EFFORT_DRIFT_EPSILON_DAYS / 2, settings).isMaterial).toBe(false);
    expect(effortDrift(project("S"), 3, settings).isMaterial).toBe(true);
  });

  it("reports a wholly unassigned row as materially adrift", () => {
    const drift = effortDrift(project("XL"), 0, settings);
    expect(drift.delta).toBe(-114);
    expect(drift.isMaterial).toBe(true);
  });
});

describe("focusByCapability", () => {
  it("weights by FTE, so a part-time person moves it by their part", () => {
    // 0.5 of someone at 100% and a whole person at 50%, both on BE:
    // (0.5*1 + 1*0.5) / 1.5 = 0.667.
    const people = [person("a", 1, [["BE", 0.5]]), person("b", 0.5, [["BE", 1]])];
    expect(focusByCapability(people).BE).toBeCloseTo(1 / 1.5, 10);
  });

  it("keeps a split person's two halves independent of each other", () => {
    // One person, 0.5 BE + 0.5 SEC at 60%: both capabilities get 60%, not a
    // number diluted by the fact that they also do something else.
    const people = [person("a", 0.6, [["BE", 0.5], ["SEC", 0.5]])];
    const focus = focusByCapability(people);
    expect(focus.BE).toBeCloseTo(0.6, 10);
    expect(focus.SEC).toBeCloseTo(0.6, 10);
  });

  it("falls back to the default where nobody works, rather than to zero", () => {
    // Zero would read as "this pool delivers nothing" and stall every project
    // needing it — a variant hiring into an empty capability must still plan.
    expect(focusByCapability([person("a", 0.9, [["BE", 1]])]).UX).toBe(
      DEFAULT_PERSON_FOCUS_FACTOR,
    );
  });
});

describe("effectiveDaysByCapability", () => {
  const roster = [
    person("a", 0.9, [["BE", 1]]),
    person("b", 0.5, [["BE", 1]]),
    person("c", 0.8, [["FE", 0.7], ["BE", 0.3]]),
  ];

  it("paces each capability at its own people's rate", () => {
    const rate = effectiveDaysByCapability(roster, settings);
    const focus = focusByCapability(roster);
    expect(rate.BE).toBeCloseTo(settings.workingDaysPerMonth * focus.BE, 10);
    expect(rate.FE).toBeCloseTo(settings.workingDaysPerMonth * 0.8, 10);
    // BE's mix of 0.9, 0.5 and 0.8 is slower than FE's single 0.8 person.
    expect(rate.BE).toBeLessThan(rate.FE);
  });

  // The property schema v15 relies on. Every person was migrated to the single
  // global focus factor being retired, so every capability's weighted mean is
  // that same number and every rate lands exactly on the old
  // `workingDaysPerMonth × 0.7`. The migration therefore changes no schedule.
  it("reproduces the retired global focus factor when everyone shares it", () => {
    const uniform = roster.map((p) => ({ ...p, focusFactor: DEFAULT_PERSON_FOCUS_FACTOR }));
    const rate = effectiveDaysByCapability(uniform, settings);
    const old = settings.workingDaysPerMonth * DEFAULT_PERSON_FOCUS_FACTOR;
    for (const capability of ["BE", "FE", "UX"] as Capability[]) {
      expect(rate[capability]).toBeCloseTo(old, 10);
    }
  });

  it("leaves the pool counting people, so crew targets stay comparable", () => {
    // The bug this shape avoids: scaling the pool instead of the rate would
    // leave two BE people looking like 1.4 against a crew target of 2, and
    // the phase would never open.
    expect(derivePoolsFromPeople(roster).BE).toBeCloseTo(2.3, 10);
  });
});

describe("personEffectiveFte", () => {
  it("is what the person contributes after their own productivity", () => {
    expect(personEffectiveFte(person("a", 0.5, [["BE", 0.6], ["SEC", 0.4]]))).toBeCloseTo(0.5, 10);
  });
});
