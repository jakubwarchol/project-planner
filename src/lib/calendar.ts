/**
 * Calendar dates as `YYYY-MM-DD` strings.
 *
 * The scheduler works in months elapsed from "now" and knows nothing about
 * dates; external constraints arrive as calendar dates. These helpers are the
 * only bridge, so the conversion happens once, at the edge, instead of every
 * component inventing its own.
 *
 * `t = 0` is the start of the current month — the same anchor the timeline's
 * axis is drawn from — so the anchor stays month-shaped even though the
 * constraints no longer are.
 */

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_KEY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export interface MonthKeyParts {
  year: number;
  /** 0-based, matching `Date#getMonth`. */
  month: number;
}

export interface DateKeyParts extends MonthKeyParts {
  /** 1-based, matching `Date#getDate`. */
  day: number;
}

export function parseMonthKey(key: string | undefined | null): MonthKeyParts | null {
  if (!key) return null;
  const match = MONTH_KEY.exec(key);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1 };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Parses `YYYY-MM-DD`, rejecting days that month does not have — the regex
 * alone would accept 31 February, which would then silently roll into March.
 */
export function parseDateKey(key: string | undefined | null): DateKeyParts | null {
  if (!key) return null;
  const match = DATE_KEY.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function dateKeyOf(date: Date): string {
  return `${monthKeyOf(date)}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Months from the start of `from` to `key`, as a fraction.
 *
 * The whole part is the month difference; the fraction is how far into the
 * target month the day falls, over that month's own length. Day 01 therefore
 * lands exactly on the whole number the month-only version used to return,
 * which is what makes the v14 migration a no-op for existing plans.
 *
 * Negative when the date has already passed, which callers generally clamp to
 * zero: a constraint that expired is simply no longer a constraint. Returns
 * null for anything unparseable, so bad data reads as "no constraint" rather
 * than silently becoming month zero.
 */
export function monthsFrom(from: MonthKeyParts, key: string | undefined | null): number | null {
  const target = parseDateKey(key);
  if (!target) return null;
  const wholeMonths = (target.year - from.year) * 12 + (target.month - from.month);
  return wholeMonths + (target.day - 1) / daysInMonth(target.year, target.month);
}

const MONTH_LABELS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];

/** "17 paź 2026" — for tooltips and markers, where the bare key reads as noise. */
export function formatDateKey(key: string | undefined | null): string {
  const parts = parseDateKey(key);
  if (!parts) return "—";
  return `${parts.day} ${MONTH_LABELS[parts.month]} ${parts.year}`;
}
