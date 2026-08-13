/**
 * Calendar days as `YYYY-MM-DD` strings, plus the bridge from the
 * scheduler's fractional month-offsets to day indices.
 *
 * `calendar.ts` is scoped to month-keys only (see its own docstring) — this
 * is the day-level sibling Obsada needs for its per-day grid, real
 * assignment/leave dates, and Polish public holiday shading.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isoOfDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dateOfIso(iso: string): Date {
  const match = ISO_DATE.exec(iso);
  if (!match) throw new Error(`invalid date: ${iso}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

// UTC-anchored midnight for the diff, so a local DST transition never shifts
// a day count by one.
function utcMidnight(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((utcMidnight(b) - utcMidnight(a)) / DAY_MS);
}

export function addDays(iso: string, n: number): string {
  const d = dateOfIso(iso);
  d.setDate(d.getDate() + n);
  return isoOfDate(d);
}

/** Half-open day offset of `iso` from `originIso` — negative if `iso` is earlier. */
export function dayIndex(originIso: string, iso: string): number {
  return daysBetween(dateOfIso(originIso), dateOfIso(iso));
}

export function isoOfIndex(originIso: string, index: number): string {
  return addDays(originIso, index);
}

/** True for Mon–Fri that is not a Polish public holiday — the one definition
 *  of a working day, shared by the leave math and the schedule→grid bridge so
 *  the two can never disagree about what a day is worth. */
export function isWorkingDate(d: Date): boolean {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  return !isPolishHoliday(isoOfDate(d));
}

/** Guard against a walk that never finds its working days — a wrong year in
 *  the data should fail visibly at the bound, not hang the tab. */
const MAX_WALK_DAYS = 36_600; // ~100 years

export interface WorkingDayCalendar {
  /** Working days inside the day-index span `[startIndex, endIndex)`. */
  countBetween(startIndex: number, endIndex: number): number;
  /** First day index at or after `fromIndex` by which `workingDays` full
   *  working days have elapsed — where work consuming that many lands on the
   *  calendar. Weekends and holidays push it further out. */
  indexAfter(workingDays: number, fromIndex?: number): number;
}

/**
 * Working-day arithmetic anchored at `originIso`.
 *
 * The cumulative count is cached and extended lazily: obsada converts one
 * span per stream segment plus one per sweep slice, and each conversion is an
 * array lookup instead of a fresh walk over the calendar.
 */
export function workingDayCalendar(originIso: string): WorkingDayCalendar {
  // prefix[d] = working days in [0, d); cursor is the date at index
  // prefix.length - 1, i.e. the next day to be classified.
  const prefix: number[] = [0];
  const cursor = dateOfIso(originIso);

  function extendTo(dayIndex: number): void {
    const limit = Math.min(dayIndex, MAX_WALK_DAYS);
    while (prefix.length <= limit) {
      prefix.push(prefix[prefix.length - 1] + (isWorkingDate(cursor) ? 1 : 0));
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return {
    countBetween(startIndex, endIndex) {
      const a = Math.max(0, Math.floor(startIndex));
      const b = Math.max(a, Math.min(Math.floor(endIndex), MAX_WALK_DAYS));
      extendTo(b);
      return prefix[b] - prefix[a];
    },
    indexAfter(workingDays, fromIndex = 0) {
      const from = Math.max(0, Math.min(Math.floor(fromIndex), MAX_WALK_DAYS));
      if (workingDays <= 0) return from;
      extendTo(from);
      const target = prefix[from] + workingDays;
      for (let d = from + 1; d <= MAX_WALK_DAYS; d++) {
        extendTo(d);
        if (prefix[d] >= target) return d;
      }
      return MAX_WALK_DAYS;
    },
  };
}

const FIXED_HOLIDAYS: [month: number, day: number][] = [
  [1, 1], // Nowy Rok
  [1, 6], // Trzech Króli
  [5, 1], // Święto Pracy
  [5, 3], // Święto Konstytucji 3 Maja
  [8, 15], // Wniebowzięcie NMP
  [11, 1], // Wszystkich Świętych
  [11, 11], // Święto Niepodległości
  [12, 25], // Boże Narodzenie (1. dzień)
  [12, 26], // Boże Narodzenie (2. dzień)
];

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher).
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monthDay = h + l - 7 * m + 114;
  const month = Math.floor(monthDay / 31); // 3 = March, 4 = April
  const day = (monthDay % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Fixed-date holidays plus Easter-derived ones: Easter Sunday, Easter
 *  Monday, Zielone Świątki (Pentecost, Easter+49) and Boże Ciało (Corpus
 *  Christi, Easter+60). */
export function isPolishHoliday(iso: string): boolean {
  const d = dateOfIso(iso);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  if (FIXED_HOLIDAYS.some(([m, dd]) => m === month && dd === day)) return true;
  const offset = daysBetween(easterSunday(d.getFullYear()), d);
  return offset === 0 || offset === 1 || offset === 49 || offset === 60;
}
