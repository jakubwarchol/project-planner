import { describe, expect, it } from "vitest";
import { dateKeyOf, formatDateKey, monthKeyOf, monthsFrom, parseDateKey, parseMonthKey } from "./calendar";

describe("parseMonthKey", () => {
  it("reads a well-formed key", () => {
    expect(parseMonthKey("2026-10")).toEqual({ year: 2026, month: 9 });
    expect(parseMonthKey("2026-01")).toEqual({ year: 2026, month: 0 });
    expect(parseMonthKey("2026-12")).toEqual({ year: 2026, month: 11 });
  });

  it("rejects anything that isn't one, rather than guessing", () => {
    for (const bad of ["", "2026", "2026-13", "2026-00", "2026-1", "oct 2026", "2026-10-01"]) {
      expect(parseMonthKey(bad)).toBeNull();
    }
    expect(parseMonthKey(undefined)).toBeNull();
    expect(parseMonthKey(null)).toBeNull();
  });
});

describe("parseDateKey", () => {
  it("reads a well-formed date", () => {
    expect(parseDateKey("2026-10-17")).toEqual({ year: 2026, month: 9, day: 17 });
    expect(parseDateKey("2026-01-01")).toEqual({ year: 2026, month: 0, day: 1 });
  });

  it("rejects a day the month does not have, instead of rolling into the next one", () => {
    expect(parseDateKey("2026-02-31")).toBeNull();
    expect(parseDateKey("2026-04-31")).toBeNull();
    expect(parseDateKey("2025-02-29")).toBeNull();
  });

  it("accepts a leap day in a leap year", () => {
    expect(parseDateKey("2028-02-29")).toEqual({ year: 2028, month: 1, day: 29 });
  });

  it("rejects anything unparseable rather than guessing", () => {
    for (const bad of ["", "2026", "2026-10", "2026-10-1", "2026-13-01", "2026-10-00"]) {
      expect(parseDateKey(bad)).toBeNull();
    }
    expect(parseDateKey(undefined)).toBeNull();
    expect(parseDateKey(null)).toBeNull();
  });
});

describe("monthKeyOf / dateKeyOf", () => {
  it("pads so keys sort lexically", () => {
    expect(monthKeyOf(new Date(2026, 0, 15))).toBe("2026-01");
    expect(dateKeyOf(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dateKeyOf(new Date(2026, 9, 17))).toBe("2026-10-17");
  });
});

describe("monthsFrom", () => {
  const now = { year: 2026, month: 7 }; // August 2026

  // The property the v14 migration relies on: every value it rewrote took the
  // first of its month, and the first of a month converts to exactly the whole
  // number the month-only version used to return. Existing plans are untouched.
  it("puts the first of a month on the same whole number the month itself did", () => {
    expect(monthsFrom(now, "2026-10-01")).toBe(2);
    expect(monthsFrom(now, "2027-08-01")).toBe(12);
    expect(monthsFrom(now, "2028-02-01")).toBe(18);
    expect(monthsFrom(now, "2026-08-01")).toBe(0);
  });

  it("carries the day as a fraction of that month's own length", () => {
    // October has 31 days, so the 17th is 16/31 of the way in.
    expect(monthsFrom(now, "2026-10-17")).toBeCloseTo(2 + 16 / 31, 10);
    // February 2027 has 28, so the same day-of-month is a larger fraction.
    expect(monthsFrom(now, "2027-02-15")).toBeCloseTo(6 + 14 / 28, 10);
  });

  it("is strictly increasing across a month boundary", () => {
    const last = monthsFrom(now, "2026-10-31")!;
    const next = monthsFrom(now, "2026-11-01")!;
    expect(last).toBeLessThan(next);
    expect(next).toBe(3);
  });

  it("goes negative for a date already past, leaving the clamp to the caller", () => {
    expect(monthsFrom(now, "2026-07-01")).toBe(-1);
    expect(monthsFrom(now, "2025-08-01")).toBe(-12);
  });

  it("returns null for unparseable input, so bad data reads as no constraint", () => {
    expect(monthsFrom(now, "nonsense")).toBeNull();
    expect(monthsFrom(now, "2026-10")).toBeNull();
    expect(monthsFrom(now, undefined)).toBeNull();
  });
});

describe("formatDateKey", () => {
  it("renders a readable label", () => {
    expect(formatDateKey("2026-10-17")).toBe("17 paź 2026");
    expect(formatDateKey("2027-01-01")).toBe("1 sty 2027");
  });

  it("degrades to a dash rather than throwing on bad input", () => {
    expect(formatDateKey(undefined)).toBe("—");
    expect(formatDateKey("2026-99-01")).toBe("—");
    expect(formatDateKey("2026-10")).toBe("—");
  });
});
