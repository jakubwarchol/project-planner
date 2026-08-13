import { describe, expect, it } from "vitest";
import { DEFAULT_PERSON_FOCUS_FACTOR } from "./estimation";
import { isoOfDate, isoOfIndex, workingDayCalendar } from "./days";
import {
  buildDemandItems,
  buildPersonLoadRows,
  buildProjectStaffingRows,
  candidateScore,
  computeStaffingWindow,
  coverageOf,
  personLoadIn,
  proposeStaffing,
  type StaffingWindow,
} from "./staffing";
import type { CapabilitySchedule, ScheduledProject, StreamSchedule } from "./scheduling";
import type { Capability, Leave, Person, Project, StaffingAssignment } from "../types";

const WINDOW: StaffingWindow = { originIso: "2026-08-01", todayIndex: 0, windowDays: 400 };
// Matches originIso, so month offsets line up with day 0.
const TODAY = new Date(2026, 7, 1);
// The scheduler's month, in working days — what buildDemandItems now takes.
const WDPM = 18;

function fakeProject(id: string, category = "Projekty"): Project {
  return { id, name: id, category, estimate: "M" };
}

function stream(
  capability: Capability,
  startMonths: number,
  endMonths: number,
  fte: number,
  extra: Partial<StreamSchedule> = {},
): StreamSchedule {
  return {
    capability,
    phase: 1,
    demandDays: 10,
    crewFte: fte,
    maxFte: fte,
    setsPace: false,
    isBurst: false,
    minFte: fte,
    segments: [{ startMonths, endMonths, fte, isFullyStaffed: true }],
    startMonths,
    endMonths,
    ...extra,
  };
}

function fakeScheduledProject(project: Project, streams: StreamSchedule[]): ScheduledProject {
  return {
    project,
    streams,
    phases: [],
    segments: [],
    startMonths: 0,
    endMonths: 6,
    fteMonths: 0,
    isImpossible: false,
    impossibleReasons: [],
    isOverPool: false,
    overPoolCapabilities: [],
    assignedEffortDays: 0,
    hasNoDemand: false,
    earliestStartMonths: 0,
    waits: [],
    contiguityDelayMonths: 0,
  };
}

function fakeSchedule(scheduled: ScheduledProject[]): CapabilitySchedule {
  const zero = { PM: 0, UX: 0, TL: 0, BE: 0, FE: 0, QA: 0, SEC: 0 };
  return {
    scheduled,
    idleSpans: [],
    transfers: [],
    pools: zero,
    horizonMonths: 6,
    idleFteMonths: zero,
    shortfallFteMonths: zero,
    truncated: false,
  };
}

function fakePerson(id: string, capability: Capability = "BE", availability = 1): Person {
  return {
    id,
    name: id,
    teamId: "ZWO",
    allocations: [{ capability, fte: availability }],
    focusFactor: DEFAULT_PERSON_FOCUS_FACTOR,
  };
}

function fakeAssignment(overrides: Partial<StaffingAssignment>): StaffingAssignment {
  return {
    id: "a1",
    personId: "person-1",
    projectId: "p1",
    capability: "BE",
    startDate: "2026-08-01",
    endDate: "2026-08-11",
    fte: 1,
    ...overrides,
  };
}

/** The day index the scheduler's month-offset `m` lands on in these fixtures:
 *  `m` months = `m × WDPM` working days walked over the real calendar. */
const fixtureCal = workingDayCalendar(WINDOW.originIso);
const at = (m: number) => fixtureCal.indexAfter(Math.round(m * WDPM), WINDOW.todayIndex);
const iso = (m: number) => isoOfIndex(WINDOW.originIso, at(m));

describe("computeStaffingWindow", () => {
  it("anchors the origin at the earlier of today and the earliest record, month-truncated", () => {
    const today = new Date(2026, 7, 11); // Aug 11 2026
    const leave: Leave = { id: "l1", personId: "p", startDate: "2026-06-15", endDate: "2026-06-20", kind: "urlop" };
    const window = computeStaffingWindow([], [leave], fakeSchedule([]), today, WDPM);
    expect(window.originIso).toBe("2026-06-01");
  });

  it("falls back to this month when there is no earlier record", () => {
    const today = new Date(2026, 7, 11);
    const window = computeStaffingWindow([], [], fakeSchedule([]), today, WDPM);
    expect(window.originIso).toBe("2026-08-01");
    expect(window.todayIndex).toBe(10);
    expect(window.windowDays).toBeGreaterThanOrEqual(window.todayIndex + 180);
  });
});

describe("buildDemandItems", () => {
  it("turns one capability's streams into one item on the day grid", () => {
    const schedule = fakeSchedule([
      fakeScheduledProject(fakeProject("p1"), [stream("BE", 0, 2, 1.5)]),
    ]);
    const [item] = buildDemandItems(schedule, WINDOW, WDPM);
    expect(item.id).toBe("p1:BE");
    expect(item.start).toBe(at(0));
    expect(item.end).toBe(at(2));
    expect(item.peakFte).toBeCloseTo(1.5);
    // FTE × working days: the span covers exactly 2 × WDPM of them, however
    // many calendar days the weekends stretch it across.
    expect(item.requiredFteDays).toBeCloseTo(1.5 * 2 * WDPM);
  });

  it("unions a capability that straddles both phases into a single item with a step", () => {
    // PM and TL run in faza 1 and faza 2 at different crews. They are one
    // posting, not two, but the FTE step between them has to survive.
    const schedule = fakeSchedule([
      fakeScheduledProject(fakeProject("p1"), [
        stream("PM", 0, 1, 0.4, { phase: 1 }),
        stream("PM", 1, 4, 0.9, { phase: 2 }),
      ]),
    ]);
    const items = buildDemandItems(schedule, WINDOW, WDPM);
    expect(items).toHaveLength(1);
    expect(items[0].phases).toEqual([1, 2]);
    expect(items[0].start).toBe(at(0));
    expect(items[0].end).toBe(at(4));
    expect(items[0].peakFte).toBeCloseTo(0.9);
  });

  it("carries the pace-setter flag through so the panel can name the constraint", () => {
    const schedule = fakeSchedule([
      fakeScheduledProject(fakeProject("p1"), [
        stream("BE", 0, 2, 2, { setsPace: true, maxFte: 2 }),
        stream("QA", 0, 2, 0.3),
      ]),
    ]);
    const items = buildDemandItems(schedule, WINDOW, WDPM);
    expect(items.find((i) => i.capability === "BE")!.setsPace).toBe(true);
    expect(items.find((i) => i.capability === "QA")!.setsPace).toBe(false);
  });

  it("produces nothing for a project the scheduler could not place", () => {
    const impossible = fakeScheduledProject(fakeProject("p1"), [
      { ...stream("BE", 0, 0, 0), segments: [], endMonths: Infinity },
    ]);
    expect(buildDemandItems(fakeSchedule([impossible]), WINDOW, WDPM)).toEqual([]);
  });
});

describe("coverageOf", () => {
  const schedule = fakeSchedule([fakeScheduledProject(fakeProject("p1"), [stream("BE", 0, 2, 1)])]);
  const [item] = buildDemandItems(schedule, WINDOW, WDPM);

  it("reports the whole window missing when nobody is assigned", () => {
    const c = coverageOf(item, [], [], WINDOW);
    expect(c.peakGap).toBeCloseTo(1);
    expect(c.minAssigned).toBe(0);
    expect(c.coveredPct).toBe(0);
    expect(c.peopleCount).toBe(0);
  });

  it("closes the gap once one assignment covers the whole window at full FTE", () => {
    const a = fakeAssignment({ startDate: iso(0), endDate: iso(2), fte: 1 });
    const c = coverageOf(item, [a], [], WINDOW);
    expect(c.peakGap).toBeCloseTo(0);
    expect(c.coveredPct).toBe(100);
    expect(c.peopleCount).toBe(1);
  });

  it("reads obsadzone at the thinnest moment, not the average", () => {
    // Full cover for the first half, nothing for the second: averaging would
    // call this half-staffed, which reads as "a bit short everywhere" rather
    // than "completely unstaffed from October".
    const a = fakeAssignment({ startDate: iso(0), endDate: iso(1), fte: 1 });
    const c = coverageOf(item, [a], [], WINDOW);
    expect(c.minAssigned).toBe(0);
    expect(c.peakGap).toBeCloseTo(1);
    expect(c.coveredPct).toBeGreaterThan(30);
    expect(c.coveredPct).toBeLessThan(70);
  });

  it("adds two people up rather than treating either as sufficient", () => {
    const c = coverageOf(
      item,
      [
        fakeAssignment({ id: "a1", personId: "p-1", startDate: iso(0), endDate: iso(2), fte: 0.6 }),
        fakeAssignment({ id: "a2", personId: "p-2", startDate: iso(0), endDate: iso(2), fte: 0.4 }),
      ],
      [],
      WINDOW,
    );
    expect(c.peakGap).toBeCloseTo(0);
    expect(c.peopleCount).toBe(2);
  });

  it("ignores the part of an assignment that runs past the plan's need", () => {
    // Being on the books until March does not over-cover a January need, and
    // a surplus is never a negative gap.
    const a = fakeAssignment({ startDate: iso(0), endDate: iso(9), fte: 1 });
    const c = coverageOf(item, [a], [], WINDOW);
    expect(c.peakGap).toBeCloseTo(0);
    expect(c.slices.every((s) => s.end <= item.end)).toBe(true);
  });

  it("opens a gap on exactly the assigned person's leave days", () => {
    const a = fakeAssignment({ startDate: iso(0), endDate: iso(2), fte: 1 });
    const leave: Leave = { id: "l1", personId: "person-1", startDate: "2026-08-05", endDate: "2026-08-12", kind: "urlop" };
    const c = coverageOf(item, [a], [leave], WINDOW);
    // Days 4..11 are uncovered; everything around them still is.
    expect(c.peakGap).toBeCloseTo(1);
    expect(c.slices.find((s) => s.start === 4 && s.end === 11)?.gap).toBeCloseTo(1);
    expect(c.coveredPct).toBeLessThan(100);
    // Aug 5–11 2026 holds five working days — the weekend inside the leave
    // costs nothing, so the shortfall is 5 FTE-days, not 7.
    expect(c.missingFteDays).toBeCloseTo(5);
    // The bar itself stays whole — only the coverage under it is cut.
    expect(c.runs).toHaveLength(1);
    expect(c.runs[0].end - c.runs[0].start).toBe(at(2));
  });

  it("ignores someone else's leave entirely", () => {
    const a = fakeAssignment({ startDate: iso(0), endDate: iso(2), fte: 1 });
    const leave: Leave = { id: "l1", personId: "someone-else", startDate: "2026-08-05", endDate: "2026-08-12", kind: "urlop" };
    const c = coverageOf(item, [a], [leave], WINDOW);
    expect(c.peakGap).toBeCloseTo(0);
    expect(c.coveredPct).toBe(100);
  });
});

describe("buildPersonLoadRows", () => {
  it("splits a slice between everything live in it and leaves the rest free", () => {
    const person = fakePerson("person-1", "BE", 1);
    const rows = buildPersonLoadRows(
      [person],
      [
        fakeAssignment({ id: "a1", projectId: "p1", startDate: "2026-08-01", endDate: "2026-08-21", fte: 0.5 }),
        fakeAssignment({ id: "a2", projectId: "p2", startDate: "2026-08-11", endDate: "2026-08-21", fte: 0.3 }),
      ],
      [],
      WINDOW,
    );
    const [row] = rows;
    expect(row.slices).toHaveLength(2);
    expect(row.slices[0].shares).toHaveLength(1);
    expect(row.slices[0].total).toBeCloseTo(0.5);
    expect(row.slices[1].shares).toHaveLength(2);
    expect(row.slices[1].total).toBeCloseTo(0.8);
  });

  it("scales shares against availability, not against a whole person", () => {
    // Someone at 0.5 FTE carrying 0.25 is half spoken for, not a quarter.
    const person = fakePerson("person-1", "PM", 0.5);
    const [row] = buildPersonLoadRows(
      [person],
      [fakeAssignment({ capability: "PM", fte: 0.25 })],
      [],
      WINDOW,
    );
    expect(row.capacity).toBeCloseTo(0.5);
    expect(row.slices[0].total).toBeCloseTo(0.5);
  });

  it("flags overload where simultaneous FTE exceeds availability", () => {
    const person = fakePerson("person-1", "BE", 1);
    const [row] = buildPersonLoadRows(
      [person],
      [
        fakeAssignment({ id: "a1", projectId: "p1", startDate: "2026-08-01", endDate: "2026-08-11", fte: 1 }),
        fakeAssignment({ id: "a2", projectId: "p2", startDate: "2026-08-06", endDate: "2026-08-16", fte: 0.5 }),
      ],
      [],
      WINDOW,
    );
    expect(row.overRuns).toEqual([{ start: 5, end: 10, peak: 0.5 }]);
    expect(row.maxProjects).toBe(2);
    expect(row.peak).toBeCloseTo(1.5);
  });

  it("treats any FTE assigned during leave as an over-commitment", () => {
    const person = fakePerson("person-1", "BE", 1);
    const leave: Leave = { id: "l1", personId: "person-1", startDate: "2026-08-03", endDate: "2026-08-05", kind: "urlop" };
    const [row] = buildPersonLoadRows(
      [person],
      [fakeAssignment({ startDate: "2026-08-01", endDate: "2026-08-11", fte: 1 })],
      [leave],
      WINDOW,
    );
    // Days 2..4 have an absent person fully booked — the whole FTE is over.
    expect(row.overRuns).toEqual([{ start: 2, end: 4, peak: 1 }]);
  });

  it("shrinks free capacity by the window's leave days", () => {
    const person = fakePerson("person-1", "BE", 1);
    const leave: Leave = { id: "l1", personId: "person-1", startDate: "2026-08-01", endDate: "2026-08-11", kind: "urlop" };
    const withLeave = buildPersonLoadRows([person], [], [leave], WINDOW)[0];
    const without = buildPersonLoadRows([person], [], [], WINDOW)[0];
    expect(withLeave.freeFte).toBeCloseTo(without.freeFte - 10 / WINDOW.windowDays, 6);
  });

  it("carries leave through as its own band rather than shortening assignments", () => {
    const leave: Leave = { id: "l1", personId: "person-1", startDate: "2026-08-03", endDate: "2026-08-10", kind: "urlop" };
    const [row] = buildPersonLoadRows([fakePerson("person-1")], [], [leave], WINDOW);
    expect(row.leaveBands).toEqual([{ leave, start: 2, end: 9 }]);
  });
});

describe("personLoadIn", () => {
  const person = fakePerson("person-1", "BE", 1);

  it("measures the peak inside the window and ignores what is outside it", () => {
    const load = personLoadIn(
      person,
      [
        fakeAssignment({ id: "a1", startDate: "2026-08-01", endDate: "2026-08-11", fte: 0.6 }),
        fakeAssignment({ id: "a2", projectId: "p2", startDate: "2026-09-01", endDate: "2026-09-11", fte: 1 }),
      ],
      [],
      WINDOW,
      0,
      10,
    );
    expect(load.peak).toBeCloseTo(0.6);
    expect(load.free).toBeCloseTo(0.4);
    expect(load.projects).toBe(1);
  });

  it("counts overlapping leave days in the window", () => {
    const leave: Leave = { id: "l1", personId: "person-1", startDate: "2026-08-05", endDate: "2026-08-20", kind: "urlop" };
    // Aug 5 is index 4 and the window ends at 10, so the overlap is 4..9.
    const load = personLoadIn(person, [], [leave], WINDOW, 0, 10);
    expect(load.leaveDays).toBe(6);
  });

  it("discounts free by leave days instead of pretending the person is around", () => {
    // Half the window on leave: an unassigned full-timer averages 0.5 free,
    // and a 0.6 assignment on top leaves 0.4 only on the days they are in.
    const leave: Leave = { id: "l1", personId: "person-1", startDate: "2026-08-01", endDate: "2026-08-06", kind: "urlop" };
    const idle = personLoadIn(person, [], [leave], WINDOW, 0, 10);
    expect(idle.free).toBeCloseTo(0.5);
    const busy = personLoadIn(
      person,
      [fakeAssignment({ startDate: "2026-08-01", endDate: "2026-08-11", fte: 0.6 })],
      [leave],
      WINDOW,
      0,
      10,
    );
    expect(busy.free).toBeCloseTo(0.2);
    expect(busy.peak).toBeCloseTo(0.6);
  });
});

describe("buildProjectStaffingRows", () => {
  const schedule = fakeSchedule([
    fakeScheduledProject(fakeProject("p1"), [stream("BE", 0, 2, 1), stream("PM", 0, 2, 0.5)]),
  ]);
  const items = buildDemandItems(schedule, WINDOW, WDPM);

  it("packs each person into their own lane and hatches what nobody covers", () => {
    const [row] = buildProjectStaffingRows(items, [], [], WINDOW);
    // No people means no people lanes — the hatch is the whole band.
    expect(row.laneCount).toBe(0);
    expect(row.anyGap).toBe(true);
    expect(row.gapRuns[0].gap).toBeCloseTo(1.5);
    expect(row.requiredPeak).toBeCloseTo(1.5);
  });

  it("does not let a surplus in one capability paper over a hole in another", () => {
    // Two backends on a one-backend job, and nobody on PM. Netting the two
    // would report a fully staffed project with no project manager.
    const rows = buildProjectStaffingRows(
      items,
      [fakeAssignment({ capability: "BE", startDate: iso(0), endDate: iso(2), fte: 2 })],
      [],
      WINDOW,
    );
    expect(rows[0].anyGap).toBe(true);
    expect(rows[0].gapRuns[0].gap).toBeCloseTo(0.5);
  });

  it("closes the row once every capability is covered", () => {
    const rows = buildProjectStaffingRows(
      items,
      [
        fakeAssignment({ id: "a1", personId: "p-1", capability: "BE", startDate: iso(0), endDate: iso(2), fte: 1 }),
        fakeAssignment({ id: "a2", personId: "p-2", capability: "PM", startDate: iso(0), endDate: iso(2), fte: 0.5 }),
      ],
      [],
      WINDOW,
    );
    expect(rows[0].anyGap).toBe(false);
    expect(rows[0].gapRuns).toEqual([]);
    expect(rows[0].peopleCount).toBe(2);
    expect(rows[0].laneCount).toBe(2);
  });

  it("re-opens the gap while the covering person is on leave", () => {
    const leave: Leave = { id: "l1", personId: "p-1", startDate: "2026-08-05", endDate: "2026-08-12", kind: "urlop" };
    const rows = buildProjectStaffingRows(
      items,
      [
        fakeAssignment({ id: "a1", personId: "p-1", capability: "BE", startDate: iso(0), endDate: iso(2), fte: 1 }),
        fakeAssignment({ id: "a2", personId: "p-2", capability: "PM", startDate: iso(0), endDate: iso(2), fte: 0.5 }),
      ],
      [leave],
      WINDOW,
    );
    expect(rows[0].anyGap).toBe(true);
    expect(rows[0].gapRuns).toEqual([{ start: 4, end: 11, gap: 1 }]);
    // The bar itself still spans the whole posting.
    expect(rows[0].bars.find((b) => b.assignment.id === "a1")!.end).toBe(at(2));
  });
});

describe("working-day month mapping", () => {
  // A window on a clean Monday keeps the arithmetic visible: March 2026 has
  // no Polish holidays, so only weekends stretch the calendar.
  const MON_WINDOW: StaffingWindow = { originIso: "2026-03-02", todayIndex: 0, windowDays: 400 };
  const oneMonth = () =>
    fakeSchedule([fakeScheduledProject(fakeProject("p1"), [stream("BE", 0, 1, 1)])]);

  it("ends a one-month phase after exactly workingDaysPerMonth working days", () => {
    const [item] = buildDemandItems(oneMonth(), MON_WINDOW, 18);
    expect(item.start).toBe(0);
    // 18 working days from Mon Mar 2: three full weeks plus Mar 23–25, so the
    // bar closes at Mar 26 — 24 calendar days for 18 of work.
    expect(item.end).toBe(24);
  });

  it("prices a wholly-unstaffed scheduler month at exactly one osobomiesiąc", () => {
    const [item] = buildDemandItems(oneMonth(), MON_WINDOW, 18);
    const c = coverageOf(item, [], [], MON_WINDOW);
    expect(item.requiredFteDays).toBeCloseTo(18);
    // The footer divides by workingDaysPerMonth, so this reads as 1.0.
    expect(c.missingFteDays).toBeCloseTo(18);
  });

  it("respects a non-default working-day month", () => {
    const [item] = buildDemandItems(oneMonth(), MON_WINDOW, 10);
    expect(item.end).toBe(12); // ten working days end right after Fri Mar 13
    expect(item.requiredFteDays).toBeCloseTo(10);
  });
});

describe("proposeStaffing", () => {
  const schedule = fakeSchedule([fakeScheduledProject(fakeProject("p1"), [stream("BE", 0, 2, 1)])]);
  const [item] = buildDemandItems(schedule, WINDOW, WDPM);

  it("fills a hole with the free matching person, at the gap's size", () => {
    const person = fakePerson("dev-1", "BE");
    const proposals = proposeStaffing([item], [person], [], [], WINDOW);
    expect(proposals).toEqual([{ itemId: item.id, personId: "dev-1", fte: 1 }]);
  });

  it("splits the hole across people when nobody free covers it alone", () => {
    const half = fakePerson("dev-1", "BE");
    const busy = fakeAssignment({ id: "b", personId: "dev-1", projectId: "other", startDate: iso(0), endDate: iso(2), fte: 0.5 });
    const full = fakePerson("dev-2", "BE");
    const proposals = proposeStaffing([item], [half, full], [busy], [], WINDOW);
    // dev-2 is freer so goes first at the full gap; nothing is left for dev-1.
    expect(proposals).toEqual([{ itemId: item.id, personId: "dev-2", fte: 1 }]);
  });

  it("tops up with a second person instead of overbooking the first", () => {
    const a = fakePerson("dev-1", "BE");
    const b = fakePerson("dev-2", "BE");
    const parallel = [
      fakeAssignment({ id: "b1", personId: "dev-1", projectId: "other", startDate: iso(0), endDate: iso(2), fte: 0.6 }),
      fakeAssignment({ id: "b2", personId: "dev-2", projectId: "other", startDate: iso(0), endDate: iso(2), fte: 0.6 }),
    ];
    const proposals = proposeStaffing([item], [a, b], parallel, [], WINDOW);
    expect(proposals).toHaveLength(2);
    expect(proposals.map((p) => p.fte)).toEqual([0.4, 0.4]);
    // 0.2 of the requirement stays open rather than pushing anyone past 1.0.
  });

  it("proposes nothing when the capability has nobody with head-room", () => {
    const person = fakePerson("dev-1", "BE");
    const busy = fakeAssignment({ id: "b", personId: "dev-1", projectId: "other", startDate: iso(0), endDate: iso(2), fte: 1 });
    expect(proposeStaffing([item], [person], [busy], [], WINDOW)).toEqual([]);
  });

  it("never re-proposes someone already assigned to the item", () => {
    const person = fakePerson("dev-1", "BE");
    const already = fakeAssignment({ id: "a", personId: "dev-1", projectId: "p1", capability: "BE", startDate: iso(0), endDate: iso(1), fte: 0.5 });
    const other = fakePerson("dev-2", "BE");
    const proposals = proposeStaffing([item], [person, other], [already], [], WINDOW);
    expect(proposals.every((p) => p.personId === "dev-2")).toBe(true);
  });

  it("prefers the person whose primary capability matches", () => {
    const secondary: Person = {
      id: "mixed",
      name: "mixed",
      teamId: "ZWO",
      allocations: [{ capability: "TL", fte: 0.6 }, { capability: "BE", fte: 0.4 }],
      focusFactor: DEFAULT_PERSON_FOCUS_FACTOR,
    };
    const primary = fakePerson("pure", "BE");
    const [first] = proposeStaffing([item], [secondary, primary], [], [], WINDOW);
    expect(first.personId).toBe("pure");
  });
});

describe("candidateScore", () => {
  it("prefers the more productive of two equally free candidates", () => {
    const base = { match: 1, free: 0.5, leaveDays: 0, projects: 1 };
    expect(candidateScore({ ...base, focusFactor: 0.9 })).toBeGreaterThan(
      candidateScore({ ...base, focusFactor: 0.5 }),
    );
  });

  it("keeps a capability match worth more than any amount of free time", () => {
    expect(candidateScore({ match: 1, free: 0, focusFactor: 1, leaveDays: 0, projects: 0 })).toBeGreaterThan(
      candidateScore({ match: 0, free: 1, focusFactor: 1, leaveDays: 0, projects: 0 }),
    );
  });
});

// Sanity check that isoOfDate agrees with the literal window origin used above.
describe("fixtures", () => {
  it("originIso matches the literal date used in the window fixtures", () => {
    expect(isoOfDate(TODAY)).toBe(WINDOW.originIso);
  });
});
