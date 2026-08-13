import { describe, expect, it } from "vitest";
import {
  addDays,
  dateOfIso,
  dayIndex,
  isoOfDate,
  isoOfIndex,
  isPolishHoliday,
  isWorkingDate,
  workingDayCalendar,
} from "./days";

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

describe("isWorkingDate", () => {
  it("rejects weekends and Polish holidays, accepts an ordinary weekday", () => {
    expect(isWorkingDate(new Date(2026, 7, 1))).toBe(false); // Saturday
    expect(isWorkingDate(new Date(2026, 7, 2))).toBe(false); // Sunday
    expect(isWorkingDate(new Date(2026, 4, 1))).toBe(false); // Friday, Święto Pracy
    expect(isWorkingDate(new Date(2026, 7, 11))).toBe(true); // Tuesday
  });
});

describe("workingDayCalendar", () => {
  it("lands 18 working days from a clean Monday 24 calendar days later", () => {
    // March 2026 has no holidays: 18 working days from Mon Mar 2 are
    // Mar 2–6, 9–13, 16–20 and 23–25, so the walk ends on Mar 26 — the
    // weekends alone stretch 18 days of work across 24 of calendar.
    const cal = workingDayCalendar("2026-03-02");
    expect(cal.indexAfter(18)).toBe(24);
    // The boundary sits right after the tenth working day (Fri Mar 13) — a
    // finished phase does not coast through the weekend behind it.
    expect(cal.indexAfter(10)).toBe(12);
    expect(cal.indexAfter(0)).toBe(0);
  });

  it("pushes the boundary one day further for a holiday inside the span", () => {
    // Five working days from Mon Apr 27 2026: Fri May 1 is Święto Pracy, so
    // the fifth lands on Mon May 4 and the walk ends at index 8, where a
    // holiday-free week would have ended at 5.
    const cal = workingDayCalendar("2026-04-27");
    expect(cal.indexAfter(4)).toBe(4);
    expect(cal.indexAfter(5)).toBe(8);
  });

  it("counts no working days across a bare weekend and walks from any index", () => {
    const cal = workingDayCalendar("2026-08-01"); // a Saturday
    expect(cal.countBetween(0, 2)).toBe(0);
    expect(cal.indexAfter(1)).toBe(3); // first working day is Mon Aug 3
    // Walking from mid-window uses the same prefix, not a new anchor.
    expect(cal.indexAfter(5, 2)).toBe(7); // Mon Aug 3 + 5 working days end after Fri Aug 7
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
