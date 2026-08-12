import { describe, expect, it } from "vitest";
import { addDays, dateOfIso, dayIndex, isoOfDate, isoOfIndex, isPolishHoliday, monthOffsetToDayIndex } from "./days";

describe("isoOfDate / dateOfIso", () => {
  it("round-trips through the local date", () => {
    const d = new Date(2026, 7, 11);
    expect(isoOfDate(d)).toBe("2026-08-11");
    expect(dateOfIso("2026-08-11").getFullYear()).toBe(2026);
    expect(dateOfIso("2026-08-11").getMonth()).toBe(7);
    expect(dateOfIso("2026-08-11").getDate()).toBe(11);
  });
});

describe("addDays / dayIndex / isoOfIndex", () => {
  it("adds and subtracts days across a month boundary", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
    expect(addDays("2026-09-02", -3)).toBe("2026-08-30");
  });

  it("is the inverse of dayIndex", () => {
    const origin = "2026-08-01";
    expect(dayIndex(origin, "2026-08-01")).toBe(0);
    expect(dayIndex(origin, "2026-08-11")).toBe(10);
    expect(dayIndex(origin, "2026-07-31")).toBe(-1);
    expect(isoOfIndex(origin, 10)).toBe("2026-08-11");
    expect(isoOfIndex(origin, -1)).toBe("2026-07-31");
  });
});

describe("monthOffsetToDayIndex", () => {
  it("walks whole months using real month lengths", () => {
    const origin = new Date(2026, 0, 31); // Jan 31
    // Jan 31 + 1 month = Feb 28 (2026 is not a leap year) — 28 days later.
    expect(monthOffsetToDayIndex(origin, 1)).toBe(28);
  });

  it("interpolates a fractional offset across the actual next month's length", () => {
    const origin = new Date(2026, 3, 1); // Apr 1, April has 30 days
    expect(monthOffsetToDayIndex(origin, 0.5)).toBe(15);
    // May has 31 days.
    expect(monthOffsetToDayIndex(origin, 1.5)).toBe(30 + 16);
  });

  it("returns 0 at offset 0", () => {
    expect(monthOffsetToDayIndex(new Date(2026, 5, 15), 0)).toBe(0);
  });
});

describe("isPolishHoliday", () => {
  it("recognises fixed-date holidays", () => {
    expect(isPolishHoliday("2026-01-01")).toBe(true);
    expect(isPolishHoliday("2026-05-01")).toBe(true);
    expect(isPolishHoliday("2026-05-03")).toBe(true);
    expect(isPolishHoliday("2026-11-11")).toBe(true);
    expect(isPolishHoliday("2026-12-25")).toBe(true);
  });

  it("recognises Easter-derived holidays for 2026 (Easter = Apr 5)", () => {
    expect(isPolishHoliday("2026-04-05")).toBe(true); // Easter Sunday
    expect(isPolishHoliday("2026-04-06")).toBe(true); // Easter Monday
    expect(isPolishHoliday("2026-05-24")).toBe(true); // Pentecost
    expect(isPolishHoliday("2026-06-04")).toBe(true); // Corpus Christi
  });

  it("rejects an ordinary working day", () => {
    expect(isPolishHoliday("2026-08-11")).toBe(false);
  });
});
