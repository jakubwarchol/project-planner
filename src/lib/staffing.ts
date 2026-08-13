/**
 * Obsada's view model: the capability-pool schedule's demand converted to a
 * day grid, and real named staffing (who is actually assigned, plus leave)
 * laid on the same grid so required-vs-assigned gaps are visible.
 *
 * This module only *reads* `scheduling.ts` output; nothing here ever feeds
 * back into it. Assigning a person cannot move a date — the plan is built from
 * pools and the crew model, and obsada is the answer to "and who, exactly".
 * (Leaves do reach the plan, but along their own path: `lib/leaves.ts` folds
 * them into the pool the simulation draws from, not through anything here.)
 *
 * A leave still renders as a band crossing the person's assignments, but it is
 * no longer only ink: on a leave day the person counts as absent, so coverage
 * drops, gaps open, and free capacity shrinks by exactly the days away.
 *
 * Geometry stays out: rows carry shares and day indices, and each view turns
 * those into pixels. That keeps the arithmetic testable and lets the three
 * screens draw the same numbers three different ways.
 */
import type { CapabilitySchedule, StreamSchedule } from "./scheduling";
import type { Capability, Leave, Person, StaffingAssignment } from "../types";
import {
  dateOfIso,
  dayIndex,
  isoOfDate,
  isoOfIndex,
  workingDayCalendar,
  type WorkingDayCalendar,
} from "./days";
import { allocationFor, personAvailability } from "./estimation";

// One working-day prefix per window origin, shared by every helper in a render
// pass — the sweeps below convert many small spans, and each would otherwise
// re-walk the calendar from scratch.
let calMemo: { originIso: string; cal: WorkingDayCalendar } | null = null;
function calendarFor(originIso: string): WorkingDayCalendar {
  if (calMemo?.originIso !== originIso) calMemo = { originIso, cal: workingDayCalendar(originIso) };
  return calMemo.cal;
}

/** A scheduler month is `workingDaysPerMonth` working days, so its place on
 *  the calendar is found by walking that many Mon–Fri-minus-holiday days from
 *  today — December stretches further than March, exactly as lived. */
function monthsToDayIndex(
  cal: WorkingDayCalendar,
  todayIndex: number,
  months: number,
  workingDaysPerMonth: number,
): number {
  return cal.indexAfter(Math.round(months * workingDaysPerMonth), todayIndex);
}

const EPS = 1e-6;
const DEFAULT_MIN_WINDOW_DAYS = 180;
const MAX_WINDOW_DAYS = 730;

/** How many projects one person is expected to carry at once before the plan
 *  is asking for more context-switching than a working day survives. Flagged,
 *  never enforced: a real week sometimes has five, and a tool that refuses to
 *  record that just stops describing the team. */
export const MAX_PARALLEL_PROJECTS = 4;

export interface StaffingWindow {
  originIso: string;
  todayIndex: number;
  /** Day count from `originIso`; the grid spans `[0, windowDays)`. */
  windowDays: number;
}

export interface Run {
  start: number;
  end: number;
}

interface FteRun extends Run {
  fte: number;
}

export interface OverRun extends Run {
  /** FTE over the person's availability at this run's worst point. */
  peak: number;
}

export interface LeaveBand extends Run {
  leave: Leave;
}

/**
 * The window's origin is the earlier of "today" and the earliest real
 * assignment/leave (month-truncated), so historical records are never
 * clipped. Its length covers at least the live schedule's horizon plus a
 * floor, clamped so a runaway horizon doesn't produce an unusable grid.
 */
export function computeStaffingWindow(
  assignments: StaffingAssignment[],
  leaves: Leave[],
  schedule: CapabilitySchedule,
  today: Date,
  workingDaysPerMonth: number,
): StaffingWindow {
  const todayIso = isoOfDate(today);
  const earliestIso = [todayIso, ...assignments.map((a) => a.startDate), ...leaves.map((l) => l.startDate)].sort()[0];
  const earliestDate = dateOfIso(earliestIso);
  const originDate = new Date(earliestDate.getFullYear(), earliestDate.getMonth(), 1);
  const originIso = isoOfDate(originDate);
  const todayIndex = dayIndex(originIso, todayIso);

  const scheduleEndIndex = monthsToDayIndex(
    calendarFor(originIso),
    todayIndex,
    schedule.horizonMonths,
    workingDaysPerMonth,
  );
  const latestRecordIso = [
    todayIso,
    ...assignments.map((a) => a.endDate),
    ...leaves.map((l) => l.endDate),
  ].sort().at(-1)!;
  const latestRecordIndex = dayIndex(originIso, latestRecordIso);

  const minEnd = todayIndex + DEFAULT_MIN_WINDOW_DAYS;
  const windowDays = Math.min(
    Math.max(minEnd, scheduleEndIndex, latestRecordIndex),
    todayIndex + MAX_WINDOW_DAYS,
  );

  return { originIso, todayIndex, windowDays };
}

// ─────────────────────────────────────────────────────────── sweeps ──

// Sweep every start/end breakpoint from the given curves and sample at the
// midpoint of each resulting slice — simple and correct for the small interval
// counts one person's or one project's records produce.
function breakpoints(...curves: Run[][]): number[] {
  const points = new Set<number>();
  for (const runs of curves) {
    for (const r of runs) {
      points.add(r.start);
      points.add(r.end);
    }
  }
  return [...points].sort((x, y) => x - y);
}

function sumAt(runs: FteRun[], point: number): number {
  return runs.filter((r) => r.start <= point && r.end > point).reduce((sum, r) => sum + r.fte, 0);
}

function activeAt<T extends Run>(runs: T[], point: number): T[] {
  return runs.filter((r) => r.start <= point && r.end > point);
}

function clampRuns<T extends Run>(runs: T[], lo: number, hi: number): T[] {
  const out: T[] = [];
  for (const r of runs) {
    const start = Math.max(lo, r.start);
    const end = Math.min(hi, r.end);
    if (end > start) out.push({ ...r, start, end });
  }
  return out;
}

function overlapDays(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

// ───────────────────────────────────────────────── leave awareness ──

function leaveRunsByPerson(leaves: Leave[], window: StaffingWindow): Map<string, Run[]> {
  const byPerson = new Map<string, Run[]>();
  for (const l of leaves) {
    const run = {
      start: dayIndex(window.originIso, l.startDate),
      end: dayIndex(window.originIso, l.endDate),
    };
    if (run.end <= run.start) continue;
    const list = byPerson.get(l.personId);
    if (list) list.push(run);
    else byPerson.set(l.personId, [run]);
  }
  return byPerson;
}

/** The pieces of `run` left once `holes` are cut out — an assignment carried
 *  by someone on leave contributes nothing on the days they are away, and
 *  this is the subtraction that says so. Overlapping holes are fine; the walk
 *  only ever moves the cursor forward. */
function subtractRuns<T extends Run>(run: T, holes: Run[]): T[] {
  const cuts = holes
    .filter((h) => h.end > run.start && h.start < run.end)
    .sort((a, b) => a.start - b.start);
  const out: T[] = [];
  let cursor = run.start;
  for (const hole of cuts) {
    if (hole.start > cursor) out.push({ ...run, start: cursor, end: hole.start });
    cursor = Math.max(cursor, hole.end);
    if (cursor >= run.end) break;
  }
  if (cursor < run.end) out.push({ ...run, start: cursor, end: run.end });
  return out;
}

// ─────────────────────────────────────────────────── demand (plan) ──

/**
 * One capability's whole need on one project — the unit obsada is assigned
 * against, and the same key a `StaffingAssignment` carries.
 *
 * PM and TL straddle both phases, so their need arrives as two streams with
 * different crews. They are unioned here rather than kept apart: an assignment
 * has no phase field, the phases run back to back, and "Tomasz on PM for ACMS"
 * is one decision. The step between the two crews stays visible in `required`,
 * which is a curve, not a number.
 */
export interface DemandItem {
  /** `${projectId}:${capability}` — stable across re-simulations. */
  id: string;
  projectId: string;
  capability: Capability;
  start: number;
  end: number;
  /** The crew this capability is planned at, over time. */
  required: FteRun[];
  /** Worst-instant crew — the headline "wymagane". */
  peakFte: number;
  /** FTE × **working** days — the unit "osobomiesięcy" figures divide by
   *  `workingDaysPerMonth`, matching the scheduler's own month. Weekends and
   *  holidays inside the span add calendar width but no effort. */
  requiredFteDays: number;
  /** Any of its streams is the one pinned at its ceiling, setting the phase's
   *  length. The cell worth raising if this project has to go faster. */
  setsPace: boolean;
  /** Every one of its streams runs as a short burst at the floor rather than
   *  being de-rated across the phase — a few days of work, not a posting. */
  isBurst: boolean;
  maxFte: number;
  phases: number[];
}

function streamRuns(
  streams: StreamSchedule[],
  window: StaffingWindow,
  workingDaysPerMonth: number,
): FteRun[] {
  const cal = calendarFor(window.originIso);
  const runs: FteRun[] = [];
  for (const stream of streams) {
    for (const seg of stream.segments) {
      const start = monthsToDayIndex(cal, window.todayIndex, seg.startMonths, workingDaysPerMonth);
      const end = monthsToDayIndex(cal, window.todayIndex, seg.endMonths, workingDaysPerMonth);
      if (end > start && seg.fte > EPS) runs.push({ start, end, fte: seg.fte });
    }
  }
  return runs;
}

/** Every project × capability the plan asks for, on the day grid. Projects the
 *  scheduler found impossible carry no segments and so produce no items —
 *  there is nothing to staff against a date that never arrives. */
export function buildDemandItems(
  schedule: CapabilitySchedule,
  window: StaffingWindow,
  workingDaysPerMonth: number,
): DemandItem[] {
  const items: DemandItem[] = [];
  const cal = calendarFor(window.originIso);

  for (const sp of schedule.scheduled) {
    const byCapability = new Map<Capability, StreamSchedule[]>();
    for (const stream of sp.streams) {
      const list = byCapability.get(stream.capability);
      if (list) list.push(stream);
      else byCapability.set(stream.capability, [stream]);
    }

    for (const [capability, streams] of byCapability) {
      const required = streamRuns(streams, window, workingDaysPerMonth);
      if (!required.length) continue;

      const points = breakpoints(required);
      let peakFte = 0;
      let requiredFteDays = 0;
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const fte = sumAt(required, (a + b) / 2);
        peakFte = Math.max(peakFte, fte);
        requiredFteDays += fte * cal.countBetween(a, b);
      }
      if (requiredFteDays <= EPS) continue;

      items.push({
        id: `${sp.project.id}:${capability}`,
        projectId: sp.project.id,
        capability,
        start: points[0],
        end: points[points.length - 1],
        required,
        peakFte,
        requiredFteDays,
        setsPace: streams.some((s) => s.setsPace),
        isBurst: streams.every((s) => s.isBurst),
        maxFte: streams.reduce((m, s) => Math.max(m, s.maxFte), 0),
        phases: [...new Set(streams.map((s) => s.phase))].sort(),
      });
    }
  }

  return items;
}

// ──────────────────────────────────────────────── coverage (obsada) ──

export interface CoverageSlice extends Run {
  required: number;
  assigned: number;
  /** Required minus assigned, floored at zero — a surplus is not a gap. */
  gap: number;
}

export interface ItemCoverage {
  slices: CoverageSlice[];
  /** Worst-instant shortfall across the item's window. */
  peakGap: number;
  /** Thinnest staffed moment — what "obsadzone" honestly reads, since a run
   *  that covers half the window does not cover the window. */
  minAssigned: number;
  /** FTE × working days, same unit as `DemandItem.requiredFteDays`. */
  missingFteDays: number;
  requiredFteDays: number;
  /** Share of the window with no shortfall at all, 0..100. */
  coveredPct: number;
  people: { personId: string; fte: number }[];
  peopleCount: number;
  runs: (Run & { assignment: StaffingAssignment })[];
}

const EMPTY_COVERAGE: ItemCoverage = {
  slices: [],
  peakGap: 0,
  minAssigned: 0,
  missingFteDays: 0,
  requiredFteDays: 0,
  coveredPct: 100,
  people: [],
  peopleCount: 0,
  runs: [],
};

/** One demand item measured against the real assignments carrying it. Runs are
 *  clipped to the item's own window: a person assigned past the plan's end is
 *  neither covering nor over-covering it. An assignment covers nothing on days
 *  its person is on leave — the bar still renders whole (`runs` stay uncut),
 *  but the coverage math sees the absence, so the gap shows on exactly those
 *  days instead of being silently absorbed. */
export function coverageOf(
  item: DemandItem,
  assignments: StaffingAssignment[],
  leaves: Leave[],
  window: StaffingWindow,
): ItemCoverage {
  const mine = assignments.filter((a) => a.projectId === item.projectId && a.capability === item.capability);
  const runs = mine.map((assignment) => ({
    assignment,
    start: dayIndex(window.originIso, assignment.startDate),
    end: dayIndex(window.originIso, assignment.endDate),
    fte: assignment.fte,
  }));

  const span = item.end - item.start;
  if (span <= 0) return { ...EMPTY_COVERAGE, runs };

  const awayByPerson = leaveRunsByPerson(leaves, window);
  const effective = runs.flatMap((r) => subtractRuns(r, awayByPerson.get(r.assignment.personId) ?? []));
  const inside = clampRuns(effective, item.start, item.end);
  const points = breakpoints(item.required, inside, [{ start: item.start, end: item.end }])
    .filter((p) => p >= item.start && p <= item.end);

  const cal = calendarFor(window.originIso);
  const slices: CoverageSlice[] = [];
  let peakGap = 0;
  let minAssigned = Infinity;
  let missingFteDays = 0;
  let coveredDays = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const mid = (start + end) / 2;
    const required = sumAt(item.required, mid);
    const assigned = sumAt(inside, mid);
    const gap = Math.max(0, required - assigned);
    slices.push({ start, end, required, assigned, gap });
    peakGap = Math.max(peakGap, gap);
    minAssigned = Math.min(minAssigned, assigned);
    missingFteDays += gap * cal.countBetween(start, end);
    if (gap <= EPS) coveredDays += end - start;
  }

  const peopleFte = new Map<string, number>();
  for (const a of mine) peopleFte.set(a.personId, (peopleFte.get(a.personId) ?? 0) + a.fte);

  return {
    slices,
    peakGap,
    minAssigned: minAssigned === Infinity ? 0 : minAssigned,
    missingFteDays,
    requiredFteDays: item.requiredFteDays,
    coveredPct: Math.round((coveredDays / span) * 100),
    people: [...peopleFte.entries()].map(([personId, fte]) => ({ personId, fte })),
    peopleCount: peopleFte.size,
    runs,
  };
}

// ────────────────────────────────────────────────────── person load ──

export interface PersonLoad {
  /** Worst-instant committed FTE inside the window. */
  peak: number;
  /** Mean genuinely spare FTE across the window, with leave days counting as
   *  zero availability. A mean rather than a worst instant on purpose: a week
   *  of urlop inside a three-month window should discount a candidate by a
   *  week, not disqualify them outright the way a min would. */
  free: number;
  capacity: number;
  leaveDays: number;
  projects: number;
  /** What the load is made of, largest first — the candidate tooltip's answer
   *  to "busy with what, exactly". */
  projectFte: { projectId: string; fte: number }[];
}

/** What a person already carries across an arbitrary window — the figure the
 *  candidate list ranks on, and the one that says whether adding them here
 *  breaks something somewhere else. */
export function personLoadIn(
  person: Person,
  assignments: StaffingAssignment[],
  leaves: Leave[],
  window: StaffingWindow,
  start: number,
  end: number,
): PersonLoad {
  const capacity = personAvailability(person);
  const runs = assignments
    .filter((a) => a.personId === person.id)
    .map((a) => ({
      start: dayIndex(window.originIso, a.startDate),
      end: dayIndex(window.originIso, a.endDate),
      fte: a.fte,
      projectId: a.projectId,
    }))
    .filter((r) => overlapDays(r.start, r.end, start, end) > 0);

  const away = clampRuns(leaveRunsByPerson(leaves, window).get(person.id) ?? [], start, end);

  const points = breakpoints(runs, away, [{ start, end }]).filter((p) => p >= start && p <= end);
  let peak = 0;
  let spareDays = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const mid = (points[i] + points[i + 1]) / 2;
    const committed = sumAt(runs, mid);
    peak = Math.max(peak, committed);
    const available = activeAt(away, mid).length > 0 ? 0 : capacity;
    spareDays += Math.max(0, available - committed) * (points[i + 1] - points[i]);
  }

  const leaveDays = away.reduce((sum, r) => sum + (r.end - r.start), 0);

  const perProject = new Map<string, number>();
  for (const r of runs) perProject.set(r.projectId, (perProject.get(r.projectId) ?? 0) + r.fte);

  return {
    peak,
    free: end > start ? spareDays / (end - start) : Math.max(0, capacity - peak),
    capacity,
    leaveDays,
    projects: perProject.size,
    projectFte: [...perProject.entries()]
      .map(([projectId, fte]) => ({ projectId, fte }))
      .sort((a, b) => b.fte - a.fte),
  };
}

/** Their largest allocation — what someone is, as opposed to what they can
 *  also do. A 0.6 TL / 0.4 BE is a tech lead who writes backend, and a
 *  candidate list that ranked those two equally would be useless. */
export function primaryCapability(person: Person): Capability | undefined {
  return person.allocations.slice().sort((a, b) => b.fte - a.fte)[0]?.capability;
}

/** Ranking weight for the candidate list — ordering only, every figure the
 *  card displays stays plain time. Free capacity is weighted by the person's
 *  own productivity: of two equally free candidates, the one whose hours
 *  deliver more work ranks first. */
export function candidateScore(c: {
  match: number;
  free: number;
  focusFactor: number;
  leaveDays: number;
  projects: number;
}): number {
  return (
    c.match * 100 +
    c.free * c.focusFactor * 40 -
    c.leaveDays * 0.3 -
    c.projects * 3 -
    (c.projects >= MAX_PARALLEL_PROJECTS ? 40 : 0)
  );
}

// ───────────────────────────────────────────────── rózdżka (wand) ──

/** One suggested assignment, not yet made — the panel renders these as cards
 *  the user accepts or rejects one by one, so nothing here writes anything. */
export interface StaffingProposal {
  itemId: string;
  personId: string;
  fte: number;
}

const MIN_PROPOSAL_FTE = 0.1;
const roundFte = (n: number) => Math.round(n * 10) / 10;

/**
 * Greedy staffing for the given open items, worst hole first: repeatedly hand
 * the item to the best-scoring person who has the capability, is not already
 * on it, and still has head-room at the item's busiest moment — never past
 * their availability, so a wand proposal cannot overbook anyone.
 *
 * Each proposal is appended to a tentative assignment list before the next is
 * chosen, so two holes cannot both claim the same free half of a person. Gaps
 * are re-read through `coverageOf`, which is leave-aware: a proposal that a
 * leave keeps from closing the hole doesn't fool the loop into stopping.
 */
export function proposeStaffing(
  items: DemandItem[],
  people: Person[],
  assignments: StaffingAssignment[],
  leaves: Leave[],
  window: StaffingWindow,
): StaffingProposal[] {
  const all = assignments.slice();
  const out: StaffingProposal[] = [];
  const gapOf = (item: DemandItem) => coverageOf(item, all, leaves, window).peakGap;

  const ordered = items.slice().sort((a, b) => gapOf(b) - gapOf(a));
  for (const item of ordered) {
    let gap = gapOf(item);
    // The guard bounds pathologies (a gap leave keeps open, a parade of 0.1
    // slivers) — eight people on one capability of one project is already
    // past the point where a human should be composing this by hand.
    let guard = 0;
    while (gap > 0.05 && guard++ < 8) {
      let best: { person: Person; allocation: number; free: number; score: number } | null = null;
      for (const person of people) {
        const allocation = allocationFor(person, item.capability);
        if (allocation <= EPS) continue;
        const taken = all.some(
          (a) =>
            a.personId === person.id &&
            a.projectId === item.projectId &&
            a.capability === item.capability,
        );
        if (taken) continue;
        const load = personLoadIn(person, all, leaves, window, item.start, item.end);
        const free = load.capacity - load.peak;
        if (free < 0.05) continue;
        const primary = primaryCapability(person) === item.capability;
        const score = (primary ? 100 : 60) + free * 40 - load.leaveDays * 0.3;
        if (!best || score > best.score) best = { person, allocation, free, score };
      }
      if (!best) break;
      const fte = Math.max(MIN_PROPOSAL_FTE, roundFte(Math.min(best.free, gap, best.allocation)));
      out.push({ itemId: item.id, personId: best.person.id, fte });
      all.push({
        id: `proposal:${item.id}:${best.person.id}`,
        personId: best.person.id,
        projectId: item.projectId,
        capability: item.capability,
        startDate: isoOfIndex(window.originIso, item.start),
        endDate: isoOfIndex(window.originIso, item.end),
        fte,
      });
      gap = gapOf(item);
    }
  }
  return out;
}

// ─────────────────────────────────────────── people rows (widok 1) ──

export interface LoadShare {
  assignment: StaffingAssignment;
  /** This assignment's FTE as a fraction of the person's whole availability. */
  share: number;
}

export interface LoadSlice extends Run {
  /** In stable stacking order — start, then id — so a band doesn't reshuffle
   *  its colours at every breakpoint. */
  shares: LoadShare[];
  /** Sum of shares; > 1 means over-committed. */
  total: number;
}

export interface PersonLoadRow {
  person: Person;
  capacity: number;
  slices: LoadSlice[];
  /** Whole-run extents, for placing one label per assignment. */
  runs: (Run & { assignment: StaffingAssignment })[];
  /** Worst-instant committed FTE across the whole window. */
  peak: number;
  /** Mean committed FTE across the window. */
  util: number;
  freeFte: number;
  overRuns: OverRun[];
  leaveBands: LeaveBand[];
  maxProjects: number;
}

function computeOverRuns(runs: FteRun[], availability: number, away: Run[]): OverRun[] {
  if (!runs.length) return [];
  const points = breakpoints(runs, away);
  const result: OverRun[] = [];
  let current: OverRun | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const mid = (start + end) / 2;
    // On a leave day there is nobody to commit: any assigned FTE at all is an
    // over-commitment, not just the part past availability.
    const cap = activeAt(away, mid).length > 0 ? 0 : availability;
    const over = sumAt(runs, mid) - cap;
    if (over > EPS) {
      if (current && current.end === start) {
        current.end = end;
        current.peak = Math.max(current.peak, over);
      } else {
        current = { start, end, peak: over };
        result.push(current);
      }
    } else {
      current = null;
    }
  }
  return result;
}

function maxConcurrentProjects(runs: (FteRun & { projectId: string })[]): number {
  if (!runs.length) return 0;
  const points = breakpoints(runs);
  let max = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const mid = (points[i] + points[i + 1]) / 2;
    max = Math.max(max, new Set(activeAt(runs, mid).map((r) => r.projectId)).size);
  }
  return max;
}

/**
 * One band per person: its full height is 100% of their availability, divided
 * between whatever projects are live at that moment, and the remainder is free
 * capacity. That is the opposite of a lane-per-project chart — you read "how
 * much of this person is spoken for" first, and "by what" second, which is the
 * question a roster is actually consulted for.
 */
export function buildPersonLoadRows(
  people: Person[],
  assignments: StaffingAssignment[],
  leaves: Leave[],
  window: StaffingWindow,
): PersonLoadRow[] {
  const byPerson = new Map<string, StaffingAssignment[]>();
  for (const a of assignments) {
    const list = byPerson.get(a.personId);
    if (list) list.push(a);
    else byPerson.set(a.personId, [a]);
  }
  const leavesByPerson = new Map<string, Leave[]>();
  for (const l of leaves) {
    const list = leavesByPerson.get(l.personId);
    if (list) list.push(l);
    else leavesByPerson.set(l.personId, [l]);
  }

  return people.map((person) => {
    const capacity = personAvailability(person);
    const runs = (byPerson.get(person.id) ?? [])
      .map((assignment) => ({
        assignment,
        start: dayIndex(window.originIso, assignment.startDate),
        end: dayIndex(window.originIso, assignment.endDate),
        fte: assignment.fte,
        projectId: assignment.projectId,
      }))
      .sort((a, b) => a.start - b.start || a.assignment.id.localeCompare(b.assignment.id));

    const points = breakpoints(runs);
    const slices: LoadSlice[] = [];
    let peak = 0;
    let fteDays = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i];
      const end = points[i + 1];
      const active = activeAt(runs, (start + end) / 2);
      if (!active.length) continue;
      const sum = active.reduce((t, r) => t + r.fte, 0);
      peak = Math.max(peak, sum);
      fteDays += sum * (end - start);
      slices.push({
        start,
        end,
        total: sum / Math.max(0.01, capacity),
        shares: active.map((r) => ({ assignment: r.assignment, share: r.fte / Math.max(0.01, capacity) })),
      });
    }

    const util = window.windowDays > 0 ? fteDays / window.windowDays : 0;

    const leaveBands: LeaveBand[] = (leavesByPerson.get(person.id) ?? []).map((leave) => ({
      leave,
      start: dayIndex(window.originIso, leave.startDate),
      end: dayIndex(window.originIso, leave.endDate),
    }));
    // Free capacity is what the window's leave days leave of the person: the
    // mean availability across the window, minus what is already committed.
    const awayDays = clampRuns(leaveBands, 0, window.windowDays).reduce(
      (sum, r) => sum + (r.end - r.start),
      0,
    );
    const meanAvailability =
      window.windowDays > 0 ? capacity * (1 - awayDays / window.windowDays) : capacity;

    return {
      person,
      capacity,
      slices,
      runs: runs.map((r) => ({ assignment: r.assignment, start: r.start, end: r.end })),
      peak,
      util,
      freeFte: Math.max(0, meanAvailability - util),
      overRuns: computeOverRuns(runs, capacity, leaveBands),
      leaveBands,
      maxProjects: maxConcurrentProjects(runs),
    };
  });
}

// ────────────────────────────────────────── project rows (widok 2) ──

export interface GapRun extends Run {
  /** Unmet FTE at this run's worst point, summed across capabilities. */
  gap: number;
}

export interface ProjectLaneBar extends Run {
  assignment: StaffingAssignment;
  lane: number;
}

export interface ProjectStaffingRow {
  projectId: string;
  bars: ProjectLaneBar[];
  laneCount: number;
  gapRuns: GapRun[];
  anyGap: boolean;
  peopleCount: number;
  start: number;
  end: number;
  /** Worst-instant total crew the plan asks this project for. */
  requiredPeak: number;
  missingFteDays: number;
}

// Greedy lane packing: each bar takes the first lane whose last occupant
// already ended, otherwise opens a new one. Packing across the whole window
// rather than per slice is what keeps a person's bar on one line while you
// scroll instead of hopping rows at every boundary.
function packLanes<T extends Run>(items: T[]): number[] {
  const laneEnds: number[] = [];
  return items.map((it) => {
    let lane = laneEnds.findIndex((end) => it.start >= end);
    if (lane === -1) {
      laneEnds.push(it.end);
      lane = laneEnds.length - 1;
    } else {
      laneEnds[lane] = it.end;
    }
    return lane;
  });
}

/**
 * The shortfall is summed **per capability, positive parts only**. Netting a
 * BE surplus against a PM hole would report a fully staffed project that has
 * nobody managing it — the pools are separate in the scheduler and they have
 * to stay separate here.
 */
function gapRunsAcross(
  items: DemandItem[],
  assignedByCapability: Map<Capability, FteRun[]>,
  cal: WorkingDayCalendar,
): { runs: GapRun[]; missingFteDays: number } {
  const curves = items.map((item) => ({
    required: item.required,
    assigned: clampRuns(assignedByCapability.get(item.capability) ?? [], item.start, item.end),
  }));
  const points = breakpoints(...curves.map((c) => c.required), ...curves.map((c) => c.assigned));

  const runs: GapRun[] = [];
  let current: GapRun | null = null;
  let missingFteDays = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const mid = (start + end) / 2;
    let gap = 0;
    for (const c of curves) gap += Math.max(0, sumAt(c.required, mid) - sumAt(c.assigned, mid));
    if (gap > EPS) {
      missingFteDays += gap * cal.countBetween(start, end);
      if (current && current.end === start) {
        current.end = end;
        current.gap = Math.max(current.gap, gap);
      } else {
        current = { start, end, gap };
        runs.push(current);
      }
    } else {
      current = null;
    }
  }
  return { runs, missingFteDays };
}

/** One row per project: a lane per assigned person over the whole window, plus
 *  one hatched lane for whatever the plan still asks for and nobody covers.
 *  The gap math counts a person as absent on their leave days — the bar stays
 *  whole, the coverage under it does not. */
export function buildProjectStaffingRows(
  items: DemandItem[],
  assignments: StaffingAssignment[],
  leaves: Leave[],
  window: StaffingWindow,
): ProjectStaffingRow[] {
  const itemsByProject = new Map<string, DemandItem[]>();
  for (const item of items) {
    const list = itemsByProject.get(item.projectId);
    if (list) list.push(item);
    else itemsByProject.set(item.projectId, [item]);
  }
  for (const a of assignments) {
    if (!itemsByProject.has(a.projectId)) itemsByProject.set(a.projectId, []);
  }

  const rows: ProjectStaffingRow[] = [];
  const awayByPerson = leaveRunsByPerson(leaves, window);

  for (const [projectId, projectItems] of itemsByProject) {
    const mine = assignments
      .filter((a) => a.projectId === projectId)
      .map((assignment) => ({
        assignment,
        start: dayIndex(window.originIso, assignment.startDate),
        end: dayIndex(window.originIso, assignment.endDate),
        fte: assignment.fte,
      }))
      .sort((a, b) => a.start - b.start || b.end - a.end);

    const assignedByCapability = new Map<Capability, FteRun[]>();
    for (const m of mine) {
      const pieces = subtractRuns(
        { start: m.start, end: m.end, fte: m.fte },
        awayByPerson.get(m.assignment.personId) ?? [],
      );
      if (!pieces.length) continue;
      const list = assignedByCapability.get(m.assignment.capability);
      if (list) list.push(...pieces);
      else assignedByCapability.set(m.assignment.capability, pieces);
    }

    const lanes = packLanes(mine);
    const { runs: gapRuns, missingFteDays } = gapRunsAcross(
      projectItems,
      assignedByCapability,
      calendarFor(window.originIso),
    );

    const starts = [...projectItems.map((i) => i.start), ...mine.map((m) => m.start)];
    const ends = [...projectItems.map((i) => i.end), ...mine.map((m) => m.end)];
    if (!starts.length) continue;

    // Peak total crew: sum every capability's requirement at each breakpoint.
    const allRequired = projectItems.flatMap((i) => i.required);
    const points = breakpoints(allRequired);
    let requiredPeak = 0;
    for (let i = 0; i < points.length - 1; i++) {
      requiredPeak = Math.max(requiredPeak, sumAt(allRequired, (points[i] + points[i + 1]) / 2));
    }

    rows.push({
      projectId,
      bars: mine.map((m, i) => ({ assignment: m.assignment, start: m.start, end: m.end, lane: lanes[i] })),
      // Genuinely zero when nobody is assigned, so the gap lane sits on the
      // baseline instead of floating above an empty lane reserved for people
      // who do not exist yet.
      laneCount: lanes.reduce((max, lane) => Math.max(max, lane + 1), 0),
      gapRuns,
      anyGap: gapRuns.length > 0,
      peopleCount: new Set(mine.map((m) => m.assignment.personId)).size,
      start: Math.min(...starts),
      end: Math.max(...ends),
      requiredPeak,
      missingFteDays,
    });
  }

  return rows;
}
