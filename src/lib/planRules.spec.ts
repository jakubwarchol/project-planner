import { describe, expect, it } from "vitest";
import {
  CEILING_STEP,
  MAX_PROJECT_CEILING,
  NEVER_RAISE_CEILING,
  ceilingRaiseBlock,
  compareScores,
  type PlanScore,
} from "./planRules";

function score(over: Partial<PlanScore> = {}): PlanScore {
  return { impossible: 0, missedDeadlines: 0, horizonMonths: 10, sumEndMonths: 30, ...over };
}

describe("compareScores", () => {
  it("healing an impossible project outranks any number of months", () => {
    const healed = score({ impossible: 0, horizonMonths: 40, sumEndMonths: 200 });
    const broken = score({ impossible: 1, horizonMonths: 5, sumEndMonths: 5 });
    expect(compareScores(healed, broken)).toBeLessThan(0);
  });

  it("the horizon outranks the sum of ends", () => {
    const shorter = score({ horizonMonths: 9, sumEndMonths: 100 });
    const denser = score({ horizonMonths: 10, sumEndMonths: 20 });
    expect(compareScores(shorter, denser)).toBeLessThan(0);
  });

  it("the sum of ends breaks a horizon tie", () => {
    expect(compareScores(score({ sumEndMonths: 20 }), score({ sumEndMonths: 30 }))).toBeLessThan(0);
  });

  it("missed deadlines are informational — they never rank", () => {
    expect(compareScores(score({ missedDeadlines: 5 }), score())).toBe(0);
  });
});

describe("ceilingRaiseBlock", () => {
  it("never allows the capabilities whose ceiling describes the project", () => {
    for (const capability of NEVER_RAISE_CEILING) {
      expect(ceilingRaiseBlock(capability, 1, 99)).toBe("forbidden");
    }
  });

  it("stops at the per-project ceiling", () => {
    expect(ceilingRaiseBlock("BE", MAX_PROJECT_CEILING, 9)).toBe("max-ceiling");
    // A step landing exactly on the limit is still allowed.
    expect(ceilingRaiseBlock("BE", MAX_PROJECT_CEILING - CEILING_STEP, 9)).toBeNull();
  });

  it("never goes past the pool", () => {
    expect(ceilingRaiseBlock("BE", 1, 1)).toBe("pool");
    expect(ceilingRaiseBlock("BE", 1, 1.5)).toBeNull();
  });

  it("allows an ordinary raise", () => {
    expect(ceilingRaiseBlock("BE", 1, 4)).toBeNull();
  });
});
