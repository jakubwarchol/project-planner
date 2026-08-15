/**
 * The shared rulebook: every planning tool judges plans and constrains
 * ceiling raises with the definitions in this file, so no two tools can
 * disagree about what "better" means or which cells may be touched. The
 * hiring planner, the ceiling autopilot and the coming hire-plus-ceilings
 * mode all rank with the same comparator — a move one tool calls an
 * improvement can never be a regression to another.
 *
 * Ranking. `impossible` leads because a project that never finishes has
 * `endMonths = Infinity`: summing it would poison `sumEndMonths`, and healing
 * one is the biggest win any move can produce, so it outranks any number of
 * months. `horizonMonths` comes next because the question every screen
 * answers is "when is all of this done" — ranking on the sum alone rewards
 * finishing many projects a little sooner even when that pushes the *last*
 * one later. The sum stays as the tie-break, so among plans that finish
 * together the one that delivers earlier on average still wins.
 *
 * Deadlines do not rank, by decision: they are soft markers drawn on the
 * timeline and adjusted by hand. `missedDeadlines` is counted and shown, but
 * `compareScores` never reads it — no tool trades the plan's length away to
 * dodge a marker.
 *
 * Ceiling raises. A ceiling of 1 on UX, TL or SEC describes the project, not
 * the team — a second designer on one project does not make it faster — so no
 * tool may raise those, ever. Everything else grows in `CEILING_STEP` hops,
 * to `MAX_PROJECT_CEILING` at most, and never past the capability's pool:
 * beyond the pool the phase's own minimum crew exceeds what exists, the
 * project is judged `min-above-pool`, and it drops out of the plan entirely —
 * a cliff, not a trade-off.
 */
import type { Capability } from "../types";
import type { CapabilitySchedule } from "./scheduling";

const EPS = 1e-6;

/** Ceilings that are never raised: 1 per project is a fact about the work,
 *  not a resourcing choice. Hiring more of these still helps — three UX
 *  cover three projects in parallel — it is the per-project count that is
 *  fixed. */
export const NEVER_RAISE_CEILING: ReadonlySet<Capability> = new Set(["UX", "TL", "SEC"]);

/** Most people of one capability that ever make sense on one project at
 *  once — the ceiling slider's top stop in Wyceny. */
export const MAX_PROJECT_CEILING = 3;

/** Half a person. Smaller steps just find the same cells more slowly, and a
 *  ceiling is a judgement about headcount — tenths would be false precision. */
export const CEILING_STEP = 0.5;

export type CeilingRaiseBlock = "forbidden" | "max-ceiling" | "pool";

/** Why a one-step raise of this cell is off the table, or null when it may be
 *  tried. Order matters: "forbidden" is a fact about the work, "max-ceiling"
 *  about the project, "pool" merely about today's team — report the most
 *  permanent one that applies. */
export function ceilingRaiseBlock(
  capability: Capability,
  from: number,
  pool: number,
): CeilingRaiseBlock | null {
  if (NEVER_RAISE_CEILING.has(capability)) return "forbidden";
  const to = from + CEILING_STEP;
  if (to > MAX_PROJECT_CEILING + EPS) return "max-ceiling";
  if (to > Math.max(1, pool) + EPS) return "pool";
  return null;
}

export interface PlanScore {
  impossible: number;
  /** Informational only — shown to the user, never compared. */
  missedDeadlines: number;
  /** When the last project finishes; 0 when nothing is schedulable. */
  horizonMonths: number;
  sumEndMonths: number;
}

export function scoreOf(
  schedule: CapabilitySchedule,
  deadlineMonths: Record<string, number> = {},
): PlanScore {
  let impossible = 0;
  let missedDeadlines = 0;
  let sumEndMonths = 0;
  let horizonMonths = 0;
  for (const sp of schedule.scheduled) {
    if (sp.isImpossible || !Number.isFinite(sp.endMonths)) {
      impossible += 1;
      continue;
    }
    sumEndMonths += sp.endMonths;
    // Over the finite ends only: an impossible project is already counted in
    // its own tier, and letting Infinity in here would flatten every horizon
    // comparison into a tie.
    if (sp.endMonths > horizonMonths) horizonMonths = sp.endMonths;
    const deadline = deadlineMonths[sp.project.id];
    if (deadline !== undefined && sp.endMonths > deadline + EPS) missedDeadlines += 1;
  }
  return { impossible, missedDeadlines, horizonMonths, sumEndMonths };
}

/** < 0 when `a` is the better plan. The integer tier compares exactly; months
 *  differences inside EPS are a tie. */
export function compareScores(a: PlanScore, b: PlanScore): number {
  if (a.impossible !== b.impossible) return a.impossible - b.impossible;
  const h = a.horizonMonths - b.horizonMonths;
  if (Math.abs(h) > EPS) return h;
  const d = a.sumEndMonths - b.sumEndMonths;
  return Math.abs(d) <= EPS ? 0 : d;
}
