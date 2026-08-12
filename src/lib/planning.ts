/**
 * `plannedStartDate` is a soft planning marker — management's intent, not a
 * scheduling input. The scheduler never sees it; this module exists purely to
 * compare it, after the fact, against what the scheduler actually computed
 * (`estimatedStart`), so a gap between intent and capacity is a visible fact
 * rather than something silently absorbed.
 */

import { type MonthKeyParts, monthsFrom } from "./calendar";

/**
 * `estimatedStart - plannedStart`, in months. Positive means the plan starts
 * later than management intended; negative means earlier. `null` when there
 * is no planned start to compare against — "no drift" would claim a fact
 * nothing supports.
 *
 * Deliberately unclamped in both directions: a planned start already in the
 * past (even before `earliestStartDate`) is still a valid point of
 * comparison — the point is to surface the gap, not to pre-judge which side
 * is "wrong".
 */
export function computeStartDrift(
  now: MonthKeyParts,
  estimatedStartMonths: number,
  plannedStartDate: string | undefined,
): number | null {
  if (!Number.isFinite(estimatedStartMonths)) return null;
  const planned = monthsFrom(now, plannedStartDate);
  if (planned == null) return null;
  return estimatedStartMonths - planned;
}
