import type { Estimate, Project } from "../types";

// Convex, not constant-ratio: value = rank^2.35 (rank 1..5, S..XXL), rounded.
// Each tier costs disproportionately more than the last — going one size up
// near the top adds far more effort than one size up near the bottom.
// Exponent calibrated so XXL lands on a real-world sense-check: a 10-person
// team clears one XXL in ~4.3 months (44 * 6 = 264 pure-work days).
export const ESTIMATE_VALUES: Record<Estimate, number> = {
  S: 1,
  M: 5,
  L: 13,
  XL: 26,
  XXL: 44,
};

const DAYS_PER_VALUE = 6;

// Hidden from the UI — accounts for meetings, context switching, etc.
const FOCUS_FACTOR = 0.7;

// Average work days in a month minus time off and sick leave.
const ADJUSTED_MONTHLY_WORKING_DAYS = 18;

export const EFFECTIVE_DAYS_PER_PERSON_PER_MONTH = ADJUSTED_MONTHLY_WORKING_DAYS * FOCUS_FACTOR;

export const CATEGORY_ORDER = ["Category 1", "Category 2", "Category 3", "Category 4"];

export interface TeamVariant {
  id: string;
  label: string;
  people: Record<string, number>;
}

// Seed set — the live list is user-editable and persisted, see useTeamVariants.
export const DEFAULT_TEAM_VARIANTS: TeamVariant[] = [
  {
    id: "variant-1",
    label: "Variant 1",
    people: { "Category 1": 1, "Category 2": 2, "Category 3": 10, "Category 4": 1 },
  },
  {
    id: "variant-2",
    label: "Variant 2",
    people: { "Category 1": 1, "Category 2": 2, "Category 3": 12, "Category 4": 1 },
  },
  {
    id: "variant-3",
    label: "Variant 3",
    people: { "Category 1": 2, "Category 2": 3, "Category 3": 14, "Category 4": 2 },
  },
];

export function effortDays(project: Project): number {
  return ESTIMATE_VALUES[project.estimate] * DAYS_PER_VALUE;
}

export function totalEffortDaysByCategory(projects: Project[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const project of projects) {
    totals[project.category] = (totals[project.category] ?? 0) + effortDays(project);
  }
  return totals;
}

export function monthsNeeded(totalDays: number, people: number): number {
  if (people <= 0) return Infinity;
  return totalDays / (people * EFFECTIVE_DAYS_PER_PERSON_PER_MONTH);
}

export function categoryCapacityPerMonth(people: number): number {
  return people * EFFECTIVE_DAYS_PER_PERSON_PER_MONTH;
}

export interface TimelineBar {
  project: Project;
  startMonths: number;
  endMonths: number;
}

// Projects run through the category's shared capacity one after another, in the
// order they're given — a single resourced queue, not one lane per project.
export function buildCategoryBars(projects: Project[], capacityPerMonth: number): TimelineBar[] {
  let cumulativeDays = 0;
  return projects.map((project) => {
    const days = effortDays(project);
    const startMonths = capacityPerMonth > 0 ? cumulativeDays / capacityPerMonth : Infinity;
    cumulativeDays += days;
    const endMonths = capacityPerMonth > 0 ? cumulativeDays / capacityPerMonth : Infinity;
    return { project, startMonths, endMonths };
  });
}

const GRIDLINE_STEP_MONTHS = 6;

// Longest category queue, rounded up to the next 6-month gridline, plus one
// spare segment so the timeline never ends flush with the last bar.
export function timelineHorizonMonths(projects: Project[], variant: TeamVariant): number {
  const totals = totalEffortDaysByCategory(projects);
  let longest = 0;
  for (const category of CATEGORY_ORDER) {
    const months = monthsNeeded(totals[category] ?? 0, variant.people[category] ?? 0);
    if (Number.isFinite(months)) longest = Math.max(longest, months);
  }
  const rounded = Math.ceil(longest / GRIDLINE_STEP_MONTHS) * GRIDLINE_STEP_MONTHS;
  return Math.max(rounded + GRIDLINE_STEP_MONTHS, GRIDLINE_STEP_MONTHS * 2);
}

export function gridlineMonths(horizonMonths: number): number[] {
  const ticks: number[] = [];
  for (let m = GRIDLINE_STEP_MONTHS; m <= horizonMonths; m += GRIDLINE_STEP_MONTHS) {
    ticks.push(m);
  }
  return ticks;
}
