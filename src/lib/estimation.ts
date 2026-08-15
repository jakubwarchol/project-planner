import type { Capability, CapabilityVector, CapabilityCell, Estimate, EstimationSettings, Person, Project, VariantCeilings } from "../types";

// Fixed display/rank order — independent of the weight under each size, so
// re-weighting the scale never reorders it.
export const ESTIMATE_ORDER: Estimate[] = ["S", "M", "L", "XL", "XXL"];

// Convex, not constant-ratio: value = rank^2.1246 (rank 1..5, S..XXL), rounded.
// Each tier costs disproportionately more than the last — going one size up
// near the top adds far more effort than one size up near the bottom.
// XXL is the top of the scale at 31 * 6 = 186 pure-work days; a 10-person team
// clears one in ~1.5 months. (A sixth rank, '2XL', was removed in schema v12 —
// it was a second spelling of the same t-shirt size.) These are only the
// *defaults* — see EstimationSettings for the editable versions.
export const DEFAULT_ESTIMATE_VALUES: Record<Estimate, number> = {
  S: 1,
  M: 4,
  L: 10,
  XL: 19,
  XXL: 31,
};

const DEFAULT_DAYS_PER_VALUE = 6;

/** Productivity a person starts on: the share of a working day that reaches
 *  project work once meetings, support duty and context switching have taken
 *  theirs. Also the rate assumed for FTE that belongs to nobody — a
 *  hand-typed variant pool for a capability the roster has no one in.
 *
 *  0.7 was the single global focus factor before it moved onto people, and
 *  every existing person was migrated to exactly it, so the plan the schema
 *  v15 migration hands back is the same plan it was given. */
export const DEFAULT_PERSON_FOCUS_FACTOR = 0.7;

// Average work days in a month minus time off and sick leave.
const DEFAULT_WORKING_DAYS_PER_MONTH = 18;

// A capability has to bring roughly half its intended crew before a phase is
// worth starting — below that the coordination overhead eats the progress.
const DEFAULT_MIN_STAFFING_FRACTION = 0.4;

/** Roughly half a day a week. Below this, spreading a capability across a
 *  whole phase stops describing anything real, so it runs as a short burst
 *  instead — see `lib/crew.ts`. Lives here rather than there to keep
 *  `crew.ts`'s import of this module one-directional. */
export const DEFAULT_MIN_CREW_FTE = 0.1;

/** Every value a ceiling (`maxFte`) may be set to, anywhere in the app. Half a
 *  person is the finest cut the number can honestly mean — it is a judgement
 *  about headcount, not a measurement — and three is as many as one project
 *  can usefully run in parallel on one capability. Shared so the matrix strip
 *  and the plan popover cannot drift apart. Values off this grid (legacy rows,
 *  or an autopilot ceiling above 3) still display; the first edit lands on it. */
export const CEILING_FTE_STEPS = [0.5, 1, 1.5, 2, 2.5, 3];
export const CEILING_FTE_EPS = 0.001;

export const DEFAULT_ESTIMATION_SETTINGS: EstimationSettings = {
  estimateValues: DEFAULT_ESTIMATE_VALUES,
  daysPerValue: DEFAULT_DAYS_PER_VALUE,
  workingDaysPerMonth: DEFAULT_WORKING_DAYS_PER_MONTH,
  minStaffingFraction: DEFAULT_MIN_STAFFING_FRACTION,
  minCrewFte: DEFAULT_MIN_CREW_FTE,
};

export const CATEGORY_ORDER = ["Projekty", "Procesy/Procedury", "Zespół", "AI"];

export const CAPABILITY_ORDER: Capability[] = ["PM", "UX", "TL", "BE", "FE", "QA", "SEC"];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  PM: "PM",
  UX: "UX",
  TL: "TL",
  BE: "BE",
  FE: "FE",
  QA: "QA",
  SEC: "SEC",
};

// Faza 1 (inicjacja): UX in full, PM and TL only partially — see
// SPLIT_CAPABILITIES. Faza 2 (wytwarzanie) cannot start for a project until
// every phase-1 stream is done for that project.
export const PHASE_1_CAPABILITIES: Capability[] = ["PM", "UX", "TL"];
export const PHASE_2_CAPABILITIES: Capability[] = ["PM", "TL", "BE", "FE", "QA", "SEC"];

/** Capabilities whose effort straddles both phases: a slice up front in
 *  inicjacja, the rest performed during wytwarzanie. Both split 20/80, and
 *  under the crew model (see `lib/crew.ts`) both phase-2 shares are ordinary
 *  crew streams.
 *
 *  TL's used to be a "residue": exempt from the crew test and from sticky
 *  holds, re-derived every slice to pace itself off the project's other live
 *  phase-2 streams so it landed alongside them. The crew model does that for
 *  every capability by construction — each one's FTE is *derived* to finish
 *  with the phase — so the special case had nothing left to do and is gone.
 *  Its removal also drops the awkward corollary that a project with no
 *  phase-2 crew for TL to pace against had to fold its residue back into
 *  phase 1. */
export const SPLIT_CAPABILITIES: Capability[] = ["PM", "TL"];

/** Share of a split capability's effort spent inside phase 1; the remaining
 *  1 - share is spent in phase 2. */
export const PHASE_1_SPLIT_SHARE = 0.2;

export interface TeamVariant {
  id: string;
  label: string;
  /** FTE pool per capability under this scenario. */
  fte: CapabilityVector;
  /** When true, `fte` is recomputed from the live roster on read and the
   *  editor's inputs for it are read-only. */
  isRosterDerived: boolean;
  /** Ceiling overrides the variant plans with — the hire-plus-ceilings
   *  ladder's second lever. Empty on most variants; always empty on a
   *  roster-derived one. */
  ceilings: VariantCeilings;
}

export function emptyCapabilityVector(): CapabilityVector {
  const vector = {} as CapabilityVector;
  for (const capability of CAPABILITY_ORDER) vector[capability] = 0;
  return vector;
}

/**
 * What the T-shirt size implies, in pure-work days.
 *
 * This is a **reference figure only** — a sanity check on the capability
 * matrix, never an input to the plan. Nothing in `scheduling.ts` reads it: the
 * schedule is built entirely from each project's capability row, so the matrix
 * is the single source of truth for effort. The size is how you *arrive* at a
 * row and what you check it against afterwards.
 */
export function referenceEffortDays(project: Project, settings: EstimationSettings): number {
  return settings.estimateValues[project.estimate] * settings.daysPerValue;
}

/**
 * FTE-weighted mean productivity of the people staffing each capability.
 *
 * The scheduler has no notion of individuals — it plans against a pool of FTE
 * per capability — so a per-person productivity can only reach it as a
 * per-capability aggregate. Weighting by FTE is what makes that aggregate
 * exact rather than approximate: someone giving a capability 0.3 of their time
 * moves its productivity by 0.3 of a person, not by a whole one.
 *
 * A capability nobody works in falls back to the default rather than to zero
 * (which would read as "this pool delivers nothing" and stall every project
 * needing it) — it is the rate hypothetical people are assumed to work at.
 */
export function focusByCapability(people: Person[]): CapabilityVector {
  const weighted = emptyCapabilityVector();
  const headcount = emptyCapabilityVector();
  for (const person of people) {
    for (const allocation of person.allocations) {
      weighted[allocation.capability] += allocation.fte * person.focusFactor;
      headcount[allocation.capability] += allocation.fte;
    }
  }
  const focus = emptyCapabilityVector();
  for (const capability of CAPABILITY_ORDER) {
    focus[capability] =
      headcount[capability] > 0
        ? weighted[capability] / headcount[capability]
        : DEFAULT_PERSON_FOCUS_FACTOR;
  }
  return focus;
}

/**
 * Days of estimate one FTE of each capability delivers per month — the rate
 * the scheduler paces every pool against, and the one edge where individual
 * productivity enters the plan.
 *
 * Productivity lands on the *rate* rather than on the pool for a reason that
 * is easy to get wrong: a pool is compared against a phase's derived crew,
 * and both count people. Scaling a pool of 2 BE down to "1.4 productive BE"
 * while a project still asks for a crew of 2 makes the crew test fail on
 * arithmetic that never changed — the plan gets slower for a reason nobody
 * modelled. Slowing the *rate* instead says the honest thing: the same two
 * people are on the job, and they get through less of it per month.
 *
 * Every FTE figure the user types or reads therefore stays plain headcount —
 * the roster shows 2 BE because there are two of them, and a variant that
 * hires one more says 3.
 */
export function effectiveDaysByCapability(
  people: Person[],
  settings: EstimationSettings,
): CapabilityVector {
  const focus = focusByCapability(people);
  const rate = emptyCapabilityVector();
  for (const capability of CAPABILITY_ORDER) {
    rate[capability] = settings.workingDaysPerMonth * focus[capability];
  }
  return rate;
}

/** A parked project keeps its mix/target values but draws from no pool and
 *  gets no bar anywhere — as if it didn't exist for scheduling purposes. */
export function isIncludedInPlan(project: Project): boolean {
  return project.includeInPlan !== false;
}

/** Wariant 1 ("obecny zespół") — group the roster by capability and sum
 *  everyone's availability into that capability's pool. */
export function derivePoolsFromPeople(people: Person[]): CapabilityVector {
  const pools = emptyCapabilityVector();
  for (const person of people) {
    for (const allocation of person.allocations) {
      pools[allocation.capability] = (pools[allocation.capability] ?? 0) + allocation.fte;
    }
  }
  return pools;
}

/** Total FTE a person brings, across every capability they split time between.
 *  This is what used to be the `availability` column. Headcount, not
 *  productive time — see `personEffectiveFte`. */
export function personAvailability(person: Person): number {
  return person.allocations.reduce((sum, allocation) => sum + allocation.fte, 0);
}

/** What a person actually contributes to the pools: their FTE after their own
 *  productivity. A full-time person at 70% is 0.7 effective FTE. */
export function personEffectiveFte(person: Person): number {
  return personAvailability(person) * person.focusFactor;
}

/** FTE this person gives one capability; 0 if they don't work in it. */
export function allocationFor(person: Person, capability: Capability): number {
  return person.allocations.find((a) => a.capability === capability)?.fte ?? 0;
}

/** Someone promised to more capabilities than there is of them. Surfaced, not
 *  blocked — a row mid-edit is legitimately over for a keystroke. */
export function isOverAllocated(person: Person): boolean {
  return personAvailability(person) > 1 + 1e-9;
}

/** Total demand per capability across a set of projects, from each project's
 *  capability row. Used by the comparison timeline's capability bands. */
export function totalCapabilityEffortDays(
  projects: Project[],
  cells: Record<string, Record<Capability, CapabilityCell>>,
): CapabilityVector {
  const totals = emptyCapabilityVector();
  for (const project of projects) {
    const row = cells[project.id];
    if (!row) continue;
    for (const capability of CAPABILITY_ORDER) totals[capability] += row[capability]?.days ?? 0;
  }
  return totals;
}

/** A brand new project starts with nothing assigned — the user splits its
 *  `referenceEffortDays` across capabilities by hand. */
export function emptyCapabilityCells(): Record<Capability, CapabilityCell> {
  const row = {} as Record<Capability, CapabilityCell>;
  for (const capability of CAPABILITY_ORDER) row[capability] = { days: 0, maxFte: 0 };
  return row;
}

/** Months to burn `totalDays` of effort at a given headcount staffing.
 *  `effectiveDaysPerMonth` is that capability's own rate — see
 *  `effectiveDaysByCapability`. */
export function monthsNeeded(
  totalDays: number,
  fte: number,
  effectiveDaysPerMonth: number,
): number {
  if (fte <= 0 || effectiveDaysPerMonth <= 0) return Infinity;
  return totalDays / (fte * effectiveDaysPerMonth);
}
