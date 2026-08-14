import { describe, expect, it } from "vitest";
import type { Capability, Person, Project } from "../types";
import {
  DEFAULT_ESTIMATION_SETTINGS,
  DEFAULT_PERSON_FOCUS_FACTOR,
  derivePoolsFromPeople,
  effectiveDaysByCapability,
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
