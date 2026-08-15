import { describe, expect, it } from "vitest";
import {
  CEILING_STEP,
  MAX_PROJECT_CEILING,
  NEVER_RAISE_CEILING,
  applyCeilingOverrides,
  ceilingRaiseBlock,
  compareScores,
  type PlanScore,
} from "./planRules";
import { emptyCapabilityCells } from "./estimation";

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

describe("applyCeilingOverrides", () => {
  function cells(maxFte: number) {
    const row = emptyCapabilityCells();
    row.BE = { days: 100, maxFte };
    return { p1: row };
  }

  it("lays an override on top of the matrix without touching the input", () => {
    const base = cells(1);
    const out = applyCeilingOverrides(base, { p1: { BE: 2 } });
    expect(out.p1.BE.maxFte).toBe(2);
    expect(base.p1.BE.maxFte).toBe(1);
    // Untouched rows keep identity — memo-keyed callers rely on it.
    expect(out.p1.QA).toBe(base.p1.QA);
  });

  it("acts only upward: a stale override loses to a raised matrix", () => {
    // The cell was 1 when the override (2) was accepted; the matrix has since
    // been deliberately raised to 2.5 — the later estimate wins.
    const base = cells(2.5);
    expect(applyCeilingOverrides(base, { p1: { BE: 2 } })).toBe(base);
  });

  it("returns the input object when nothing applies", () => {
    const base = cells(1);
    expect(applyCeilingOverrides(base, {})).toBe(base);
    expect(applyCeilingOverrides(base, { gone: { BE: 3 } })).toBe(base);
  });
});
