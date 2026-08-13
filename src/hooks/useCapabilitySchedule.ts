import { monthKeyOf, monthsFrom, parseMonthKey } from "../lib/calendar";
import { effectiveDaysByCapability, isIncludedInPlan } from "../lib/estimation";
import { leaveFteByMonth } from "../lib/leaves";
import { simulateCapabilitySchedule, type CapabilitySchedule } from "../lib/scheduling";
import { usePlanner } from "../state/plannerContext";
import type {
  Capability,
  CapabilityCell,
  CapabilityVector,
  EstimationSettings,
  Leave,
  Person,
  Project,
} from "../types";

/**
 * Calendar constraints become months-from-now here, at the single edge where
 * the plan meets the calendar — the scheduler itself never sees a date.
 *
 * A month already past is not a constraint, so it clamps to zero rather than
 * pulling anything backwards. `t = 0` is the start of the current month, the
 * same anchor the timeline's axis is drawn from.
 */
export function earliestStartOffsets(projects: Project[]): Record<string, number> {
  const now = parseMonthKey(monthKeyOf(new Date()))!;
  const offsets: Record<string, number> = {};
  for (const project of projects) {
    const months = monthsFrom(now, project.earliestStartDate);
    if (months != null && months > 0) offsets[project.id] = months;
  }
  return offsets;
}

type Cells = Record<string, Record<Capability, CapabilityCell>>;

interface Key {
  projects: Project[];
  cells: Cells;
  /** Headcount FTE, as the variant stores it. The productivity rate is derived
   *  inside from `people`, so both stay identity-stable. */
  pools: CapabilityVector;
  people: Person[];
  /** The reducer replaces this array on every leave edit, so its identity is
   *  exactly as stable — and as invalidating — as `projects` or `cells`. */
  leaves: Leave[];
  settings: EstimationSettings;
  minStaffingFraction: number;
  minCrewFte: number;
}

// Simulating is expensive, and four components ask for the same answer: App
// and CategoryTimeline are both mounted on the backlog screen, and each
// full-screen view adds another. `useMemo` is per component instance, so it
// cannot help across them — every caller re-ran the identical simulation.
//
// The cache is keyed on argument identity, which is already stable: `projects`
// and `cells` come from the reducer, and `pools` is a variant's own object.
// Anything that genuinely changes the plan replaces one of them and misses,
// which is exactly when a recompute is wanted.
//
// Four entries covers the concurrent distinct inputs — the variant pools the
// backlog uses plus the roster pools Obsada passes — without pinning old
// schedules alive.
const CACHE_SIZE = 4;
const cache: { key: Key; value: CapabilitySchedule }[] = [];

function sameKey(a: Key, b: Key): boolean {
  return (
    a.projects === b.projects &&
    a.cells === b.cells &&
    a.pools === b.pools &&
    a.people === b.people &&
    a.leaves === b.leaves &&
    a.settings === b.settings &&
    a.minStaffingFraction === b.minStaffingFraction &&
    a.minCrewFte === b.minCrewFte
  );
}

function sharedSchedule(key: Key): CapabilitySchedule {
  const hit = cache.find((entry) => sameKey(entry.key, key));
  if (hit) return hit.value;

  // Derived inside, not by the caller: `planned`, the per-capability rate and
  // the offsets are fresh objects every time they are computed, so deriving
  // them per component would give every caller a different identity and defeat
  // the cache.
  const planned = key.projects.filter(isIncludedInPlan);
  const value = simulateCapabilitySchedule({
    projects: planned,
    cells: key.cells,
    pools: key.pools,
    effectiveDaysPerMonth: effectiveDaysByCapability(key.people, key.settings),
    minStaffingFraction: key.minStaffingFraction,
    minCrewFte: key.minCrewFte,
    earliestStart: earliestStartOffsets(planned),
    leaveFteByMonth: leaveFteByMonth(key.people, key.leaves),
  });

  cache.unshift({ key, value });
  if (cache.length > CACHE_SIZE) cache.pop();
  return value;
}

export function useCapabilitySchedule(
  projects: Project[],
  pools: CapabilityVector,
): CapabilitySchedule {
  const { cells, people, leaves, settings } = usePlanner();
  return sharedSchedule({
    projects,
    cells,
    pools,
    people,
    leaves,
    settings,
    minStaffingFraction: settings.minStaffingFraction,
    minCrewFte: settings.minCrewFte,
  });
}
