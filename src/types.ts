export type Estimate = "S" | "M" | "L" | "XL" | "XXL";

export interface Project {
  id: string;
  name: string;
  category: string;
  estimate: Estimate;
  description?: string;
  /** Id of the project that must be handled first. */
  blockedBy?: string;
  /** Calendar date (`YYYY-MM-DD`) before which this project cannot begin, for a
   *  reason outside the plan: a contract, a budget year, another department.
   *  The scheduler treats it as hard — the project draws from no pool until
   *  then — because unlike capacity contention it is not ours to optimise. */
  earliestStartDate?: string;
  /** Calendar date (`YYYY-MM-DD`) this project is meant to be finished by.
   *  Purely a marker: the scheduler ignores it entirely and the timeline draws
   *  it, so a date it cannot meet shows up as a fact rather than being quietly
   *  planned around. */
  deadlineDate?: string;
  /** Calendar date (`YYYY-MM-DD`) management intends this project to start.
   *  Purely a soft marker, same spirit as `deadlineDate`: the scheduler
   *  never reads it and it cannot move the plan. The timeline draws it next
   *  to the computed start so a gap between intent and capacity shows up as
   *  `startDrift` (see `lib/planning.ts`) instead of being silently absorbed. */
  plannedStartDate?: string;
  /** Whether this project draws from any capability pool. Absent means true
   *  — a project stays "in plan" until explicitly parked. */
  includeInPlan?: boolean;
}

export type Capability = "PM" | "UX" | "TL" | "BE" | "FE" | "QA" | "SEC";

export type TeamCode = "ZWO" | "ZP" | "Inni";

/** Dense: every capability always present, so consumers never write `?? 0`. */
export type CapabilityVector = Record<Capability, number>;

export interface Team {
  id: TeamCode;
  label: string;
}

/** One person's share of a single capability's pool. */
export interface CapabilityAllocation {
  capability: Capability;
  /** FTE this person contributes to that capability, 0..1. */
  fte: number;
}

export interface Person {
  id: string;
  name: string;
  teamId: TeamCode;
  /** What this person works on, and how much of them each capability gets.
   *  Usually one entry; someone splitting their time carries several. Their
   *  availability is the sum — see `personAvailability`. Over-allocation past
   *  1.0 is flagged in the Zespół screen rather than blocked, because the row
   *  is edited one capability at a time and is briefly inconsistent. */
  allocations: CapabilityAllocation[];
  /** Share of a working day this person actually spends on project work,
   *  0 < f <= 1 — meetings, support duty and context switching are what the
   *  rest goes to. Shown as "produktywność %" in the Zespół screen.
   *
   *  This used to be one global `focusFactor` knob applied to every FTE
   *  alike, which could not express the real spread: a tech lead at 50% and a
   *  heads-down developer at 90% averaged into a number describing neither.
   *  It is per person now, and reaches the scheduler through
   *  `effectivePools` — the pool a capability draws on is the *focus-weighted*
   *  sum of its people, not their headcount. */
  focusFactor: number;
}

/** One cell of both matrices — always written together. */
export interface CapabilityCell {
  /** Effort in days assigned to this capability. 0 = capability not needed.
   *  These cells are what the scheduler plans from — the source of truth for
   *  effort. The project's `referenceEffortDays` is a sanity check beside
   *  them, never a constraint on them. */
  days: number;
  /** The most people you would ever usefully put on this capability's share
   *  of this project at once — a **ceiling**, not a target.
   *
   *  Nothing runs at this figure unless it happens to be the capability
   *  setting the phase's pace. Whichever capability hits its own ceiling
   *  first decides how long the phase takes; everyone else's actual FTE is
   *  then derived to finish alongside them (`lib/crew.ts`). So this is a
   *  statement about the *work* — how far it divides before people start
   *  tripping over each other — answerable while looking at one project,
   *  which is what the old "target FTE" never was. */
  maxFte: number;
}

/** A real, named person actually working a project's capability need for a
 *  date range — layered on top of the capability-pool scheduler, never fed
 *  back into it. Dates are `YYYY-MM-DD`; `endDate` is exclusive. */
export interface StaffingAssignment {
  id: string;
  personId: string;
  projectId: string;
  capability: Capability;
  startDate: string;
  endDate: string;
  /** FTE this person spends on this project/capability over the range. */
  fte: number;
}

/** A person's leave (vacation, etc.). Visually it crosses every assignment on
 *  that day rather than shortening them, so the risk stays on the chart — but
 *  it also counts: the person is absent in every capacity number (coverage,
 *  free FTE, over-commitment), and `lib/leaves.ts` folds leaves into the
 *  monthly pools the scheduler draws from, so absences genuinely extend
 *  project ends. `endDate` is exclusive, same as above. */
export interface Leave {
  id: string;
  personId: string;
  startDate: string;
  endDate: string;
  kind: string;
}

/** Tunable knobs behind the t-shirt scale — editable on the Kompetencje
 *  screen's "ustawienia" tab. See estimation.ts for how they combine. */
export interface EstimationSettings {
  /** Weight per t-shirt size, S..XXL. */
  estimateValues: Record<Estimate, number>;
  /** Days of pure effort one weight unit represents. */
  daysPerValue: number;
  /** Average working days in a month. The productivity haircut is *not* in
   *  here — it lives on each person (`Person.focusFactor`) and is applied to
   *  the pool instead, so this is a clean calendar figure. */
  workingDaysPerMonth: number;
  /** Fraction of a phase's derived crew that counts as the smallest team able
   *  to make honest progress on it, 0 < f <= 1. A phase waits until every
   *  capability it needs clears this, then never drops below it — see
   *  `simulateCapabilitySchedule`. At 1 nothing starts under-staffed. */
  minStaffingFraction: number;
  /** The FTE below which a capability stops being de-rated to fit its phase
   *  and instead runs as a short burst at this floor — see `lib/crew.ts`.
   *  Four days of security review spread across a five-month build is 0.06
   *  FTE, which is a fiction rather than a smoothing. */
  minCrewFte: number;
}
