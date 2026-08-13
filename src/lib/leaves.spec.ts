import { describe, expect, it } from "vitest";
import { DEFAULT_PERSON_FOCUS_FACTOR } from "./estimation";
import { leaveFteByMonth } from "./leaves";
import type { Leave, Person } from "../types";

// August 2026: the 1st is a Saturday, so ten weekend days; the only public
// holiday (Aug 15) falls on one of them. 21 working days.
const AUG = new Date(2026, 7, 1);
const AUG_WORKING = 21;

function person(id: string, allocations: Person["allocations"]): Person {
  return { id, name: id, teamId: "ZWO", allocations, focusFactor: DEFAULT_PERSON_FOCUS_FACTOR };
}

function leave(personId: string, startDate: string, endDate: string): Leave {
  return { id: `${personId}-${startDate}`, personId, startDate, endDate, kind: "urlop" };
}

describe("leaveFteByMonth", () => {
  const dev = person("dev", [{ capability: "BE", fte: 1 }]);

  it("reduces a capability by the working-day share of the month spent away", () => {
    // Mon Aug 3 .. Sat Aug 8 (exclusive): five working days.
    const out = leaveFteByMonth([dev], [leave("dev", "2026-08-03", "2026-08-08")], AUG);
    expect(out.BE?.[0]).toBeCloseTo(5 / AUG_WORKING, 9);
  });

  it("counts a weekend-only leave as no reduction at all", () => {
    // Sat Aug 8 .. Mon Aug 10 (exclusive): zero working days away.
    const out = leaveFteByMonth([dev], [leave("dev", "2026-08-08", "2026-08-10")], AUG);
    expect(out).toEqual({});
  });

  it("does not double-count a public holiday inside the leave", () => {
    // Nov 2026 has 20 working days; Nov 11 (Wed) is a holiday, so a Mon–Fri
    // leave that week removes four working days, not five.
    const out = leaveFteByMonth([dev], [leave("dev", "2026-11-09", "2026-11-14")], new Date(2026, 10, 1));
    expect(out.BE?.[0]).toBeCloseTo(4 / 20, 9);
  });

  it("splits a person's absence across their allocations", () => {
    const split = person("split", [
      { capability: "BE", fte: 0.5 },
      { capability: "QA", fte: 0.5 },
    ]);
    // The whole of August away: each capability loses that person's full share.
    const out = leaveFteByMonth([split], [leave("split", "2026-08-01", "2026-09-01")], AUG);
    expect(out.BE?.[0]).toBeCloseTo(0.5, 9);
    expect(out.QA?.[0]).toBeCloseTo(0.5, 9);
  });

  it("spreads a month-spanning leave over both months' own working days", () => {
    // Aug 24 .. Sep 8 (exclusive): six working days of August, five of
    // September — each month judged against its own denominator (Sep has 22).
    const out = leaveFteByMonth([dev], [leave("dev", "2026-08-24", "2026-09-08")], AUG);
    expect(out.BE?.[0]).toBeCloseTo(6 / AUG_WORKING, 9);
    expect(out.BE?.[1]).toBeCloseTo(5 / 22, 9);
  });

  it("skips months already past the origin — the past is not scheduled", () => {
    const out = leaveFteByMonth([dev], [leave("dev", "2026-08-03", "2026-08-08")], new Date(2026, 8, 1));
    expect(out).toEqual({});
  });

  it("ignores a leave whose person is not in the roster", () => {
    const out = leaveFteByMonth([dev], [leave("ghost", "2026-08-03", "2026-08-08")], AUG);
    expect(out).toEqual({});
  });

  it("sums overlapping people into the same capability and month", () => {
    const dev2 = person("dev2", [{ capability: "BE", fte: 0.8 }]);
    const out = leaveFteByMonth(
      [dev, dev2],
      [leave("dev", "2026-08-03", "2026-08-08"), leave("dev2", "2026-08-03", "2026-08-08")],
      AUG,
    );
    expect(out.BE?.[0]).toBeCloseTo((5 / AUG_WORKING) * (1 + 0.8), 9);
  });
});
