/**
 * The crew model: a phase is a team that starts together and finishes
 * together, not a set of independent streams that each finish whenever their
 * own work runs out.
 *
 * You give one number per capability — `maxFte`, the most people you would
 * ever usefully put on that kind of work at once. Nothing else. The phase's
 * length is set by whichever capability hits its ceiling first (it cannot go
 * faster, so nobody can), and every other capability's FTE is then *derived*
 * to fit that same window. Nobody is over-crewed and nobody trickles off
 * early leaving the project half-manned.
 *
 * The alternative — each stream running flat out at a typed target and
 * finishing when it finishes — is more accurate about when a person is
 * genuinely free, and unreadable: it produces streams that end months apart,
 * lonely tails where one capability keeps a project open on its own, and a
 * per-project number whose meaning depends on the rest of the portfolio. The
 * totals are identical either way; only the shape is smoothed.
 *
 * One exception, and it matters: a capability whose derived FTE would fall
 * below `minCrewFte` is not de-rated. Four days of security review across a
 * five-month build is 0.06 FTE — "a security specialist at 6% for five
 * months" is a fiction, not a smoothing. Those run as a short burst at the
 * floor and finish early, which is what actually happens.
 */
import { CAPABILITY_ORDER, DEFAULT_MIN_CREW_FTE } from "./estimation";
import type { CapabilityVector } from "../types";

const EPS = 1e-9;

export { DEFAULT_MIN_CREW_FTE };

export interface DerivedCrew {
  /** How long the phase takes with everyone at their derived FTE. 0 when the
   *  phase has no work at all. */
  months: number;
  /** Derived FTE per capability, indexed like `CAPABILITY_ORDER`. Zero where
   *  the phase owes that capability nothing. Never above `maxFte`. */
  fte: number[];
  /** The capability that set the pace — the one pinned at its own ceiling.
   *  -1 when the phase is empty. This is the honest answer to "why does this
   *  phase take this long", and the only number worth raising to speed it up. */
  paceIndex: number;
  /** Capabilities held at the floor rather than de-rated, so they finish
   *  early instead of smearing across the whole phase. */
  burstIndexes: number[];
}

export const EMPTY_CREW: DerivedCrew = {
  months: 0,
  fte: CAPABILITY_ORDER.map(() => 0),
  paceIndex: -1,
  burstIndexes: [],
};

/**
 * `days`, `maxFte` and `rate` are all indexed like `CAPABILITY_ORDER`;
 * `rate` is `effectiveDaysByCapability` — days of estimate one FTE delivers
 * per month, already carrying the productivity haircut.
 *
 * A capability with work but no ceiling (or no rate) can never be crewed. It
 * is left at zero here and caught by the scheduler's impossibility pre-pass,
 * which can name the project — this function has no idea which one it is.
 */
export function deriveCrew(
  days: number[],
  maxFte: number[],
  rate: number[],
  minCrewFte: number,
): DerivedCrew {
  const fte = CAPABILITY_ORDER.map(() => 0);
  const burstIndexes: number[] = [];
  let months = 0;
  let paceIndex = -1;

  // Pass 1: the pace. Each capability's fastest possible run is its work at
  // its own ceiling; the phase can be no shorter than the slowest of those.
  for (let k = 0; k < CAPABILITY_ORDER.length; k++) {
    if (days[k] <= EPS) continue;
    if (maxFte[k] <= EPS || rate[k] <= EPS) continue;
    const fastest = days[k] / (maxFte[k] * rate[k]);
    if (fastest > months) {
      months = fastest;
      paceIndex = k;
    }
  }
  if (months <= EPS) return { ...EMPTY_CREW, fte };

  // Pass 2: everyone else de-rates to land on that same finish. The division
  // can only ever produce something at or below the ceiling — `months` is by
  // construction no smaller than this capability's own fastest run.
  for (let k = 0; k < CAPABILITY_ORDER.length; k++) {
    if (days[k] <= EPS) continue;
    if (maxFte[k] <= EPS || rate[k] <= EPS) continue;
    const derived = days[k] / (months * rate[k]);
    if (derived < minCrewFte - EPS) {
      // A burst: run it at the floor (or its ceiling, whichever is lower —
      // a ceiling under the floor is a deliberate "one person, part time")
      // and let it finish early rather than smear.
      fte[k] = Math.min(maxFte[k], minCrewFte);
      burstIndexes.push(k);
    } else {
      fte[k] = derived;
    }
  }

  return { months, fte, paceIndex, burstIndexes };
}

/** Total headcount on the phase — an output, never an input. */
export function crewSize(crew: DerivedCrew): number {
  return crew.fte.reduce((total, f) => total + f, 0);
}

/** Vector form, for the UI. The scheduler uses the array form directly. */
export function crewVector(crew: DerivedCrew): CapabilityVector {
  const out = {} as CapabilityVector;
  CAPABILITY_ORDER.forEach((capability, k) => {
    out[capability] = crew.fte[k];
  });
  return out;
}
