/**
 * The bridge from calendar leaves to the scheduler's month-shaped world.
 *
 * The scheduler plans against a constant FTE pool per capability; a leave is a
 * date range on one person. This module folds the second into the first: for
 * every month a leave touches, the person's allocations are scaled by how much
 * of that month's *working* days they are away, and the result is summed into
 * a per-capability, per-month-offset reduction the simulation subtracts from
 * its pool (`SimulateInput.leaveFteByMonth`).
 *
 * Working days — Mon–Fri minus Polish public holidays — are the honest
 * denominator: a week of urlop over Christmas removes fewer working days than
 * one in March, and a "leave" spanning only a weekend removes none at all.
 *
 * Months are indexed from the same anchor as `earliestStartOffsets`: t = 0 is
 * the start of the current month. Months already past are not scheduled and
 * are skipped rather than clamped.
 */
import type { Capability, Leave, Person } from "../types";
import { daysInMonth } from "./calendar";
import { isWorkingDate, isoOfDate } from "./days";

/** Safety bound on how far ahead a single leave is expanded — ten years of
 *  months. Past data entered with a wrong year should not allocate an array
 *  the length of a century. */
const MAX_MONTH_OFFSET = 120;

export type LeaveFteByMonth = Partial<Record<Capability, number[]>>;

/** Per-capability FTE away in each month offset from `origin`'s month.
 *
 *  `origin` defaults to now; tests pass a fixed date. Only the year/month of
 *  it matter — the anchor is the first of that month, mirroring the
 *  scheduler's t = 0. Returns `{}` when no leave reaches any scheduled month,
 *  so callers (and the simulation) can skip the whole mechanism cheaply.
 */
export function leaveFteByMonth(
  people: Person[],
  leaves: Leave[],
  origin: Date = new Date(),
): LeaveFteByMonth {
  const out: LeaveFteByMonth = {};
  if (leaves.length === 0) return out;

  const personById = new Map(people.map((p) => [p.id, p]));
  const originYear = origin.getFullYear();
  const originMonth = origin.getMonth();

  for (const leave of leaves) {
    const person = personById.get(leave.personId);
    if (!person || person.allocations.length === 0) continue;

    for (let offset = 0; offset <= MAX_MONTH_OFFSET; offset++) {
      const year = originYear + Math.floor((originMonth + offset) / 12);
      const month = (originMonth + offset) % 12;
      const monthStartIso = isoOfDate(new Date(year, month, 1));
      // Months are walked in order, so the first month starting at or past
      // the leave's exclusive end closes the walk for this leave.
      if (monthStartIso >= leave.endDate) break;

      let working = 0;
      let away = 0;
      for (let day = 1; day <= daysInMonth(year, month); day++) {
        const date = new Date(year, month, day);
        if (!isWorkingDate(date)) continue;
        working++;
        const iso = isoOfDate(date);
        if (iso >= leave.startDate && iso < leave.endDate) away++;
      }
      if (away === 0 || working === 0) continue;

      const fraction = away / working;
      for (const allocation of person.allocations) {
        const arr = (out[allocation.capability] ??= []);
        arr[offset] = (arr[offset] ?? 0) + allocation.fte * fraction;
      }
    }
  }

  return out;
}
