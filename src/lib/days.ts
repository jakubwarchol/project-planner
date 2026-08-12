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

// Clamps to the target month's last day instead of letting `Date` overflow
// into the following month (native `Date` arithmetic would turn "Jan 31 + 1
// month" into early March, not Feb 28).
function addMonths(d: Date, months: number): Date {
  const first = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const daysInTarget = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), daysInTarget));
}

/**
 * Converts a fractional month-offset from `scheduling.ts` (e.g. `4.5`) into a
 * day index from `origin`, using real `Date` month arithmetic so actual month
 * lengths are respected rather than an average day-per-month constant. The
 * fractional remainder is interpolated across the number of days in the
 * specific month it falls into.
 */
export function monthOffsetToDayIndex(origin: Date, monthOffset: number): number {
  const wholeMonths = Math.floor(monthOffset);
  const frac = monthOffset - wholeMonths;
  const base = addMonths(origin, wholeMonths);
  const baseIndex = daysBetween(origin, base);
  if (frac === 0) return baseIndex;
  const next = addMonths(origin, wholeMonths + 1);
  const daysInSpan = daysBetween(base, next);
  return baseIndex + Math.round(frac * daysInSpan);
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
