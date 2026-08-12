import type { Capability, CapabilityCell, CapabilityVector, Project } from "../types";
import {
  CAPABILITY_ORDER,
  DEFAULT_MIN_CREW_FTE,
  PHASE_1_CAPABILITIES,
  PHASE_1_SPLIT_SHARE,
  PHASE_2_CAPABILITIES,
  SPLIT_CAPABILITIES,
  emptyCapabilityVector,
} from "./estimation";
import { deriveCrew, type DerivedCrew } from "./crew";

const EPS = 1e-9;
// Below this, a stray fraction of a day shouldn't manufacture a stream.
const MIN_STREAM_DAYS = 1e-6;

export type Phase = 1 | 2;

export interface StreamSegment {
  startMonths: number;
  endMonths: number;
  fte: number;
  isFullyStaffed: boolean;
}

export interface StreamSchedule {
  capability: Capability;
  phase: Phase;
  demandDays: number;
  /** This capability's share of the phase's **derived crew** — not the cell's
   *  `maxFte`. Only the pace-setting capability runs at its own ceiling;
   *  everyone else is de-rated to finish alongside it (`lib/crew.ts`). */
  crewFte: number;
  /** The ceiling this was derived under, echoed back so the UI can show how
   *  much room a capability had. */
  maxFte: number;
  /** This stream is what decides the phase's length — the one capability
   *  pinned at its ceiling. The only cell worth raising to go faster. */
  setsPace: boolean;
  /** Held at the settings' `minCrewFte` floor rather than de-rated, so it
   *  runs as a short burst and finishes before the rest of the phase. */
  isBurst: boolean;
  /** Smallest staffing this stream may run at — `crewFte` times the settings'
   *  `minStaffingFraction`. The phase won't open until every one of its
   *  streams clears this, and once open none of them drops below it. */
  minFte: number;
  segments: StreamSegment[];
  startMonths: number;
  /** Infinity when the project is impossible and this stream never funds. */
  endMonths: number;
}

export interface PhaseSpan {
  phase: Phase;
  startMonths: number;
  endMonths: number;
}

/** "crew" — the phase can't open yet because at least one capability can't
 *  clear its minimum, so nothing has started. "pool" — work *is* running, but
 *  a stream is staffed between its minimum and its target. */
export type WaitReason = "gate" | "crew" | "pool" | "blocked";

export interface WaitSpan {
  startMonths: number;
  endMonths: number;
  reason: WaitReason;
  /** Which capabilities are responsible for this project standing still.
   *  Empty for "blocked" — the whole project is held, not one capability. */
  capabilities: Capability[];
}

export interface ImpossibleReason {
  /** Absent for "blocked-by-impossible" and "dependency-cycle" — the cause
   *  isn't a capability. */
  capability?: Capability;
  kind: "no-pool" | "no-max" | "min-above-pool" | "blocked-by-impossible" | "dependency-cycle";
  /** Project ids forming the `blockedBy` cycle, in cycle order (a single id,
   *  repeated, for a project blocking itself). Present only for
   *  "dependency-cycle" — every project on the cycle carries the same list,
   *  so the UI can name the whole loop from any one of them. */
  cycle?: string[];
}

export interface ScheduledProject {
  project: Project;
  /** Only streams with demandDays > 0, in CAPABILITY_ORDER, phase 1 then 2. */
  streams: StreamSchedule[];
  /** Zero-length phases are omitted. */
  phases: PhaseSpan[];
  /** Roll-up across every live stream — a drop-in for a single Gantt bar. */
  segments: StreamSegment[];
  startMonths: number;
  /** Infinity when the project never finishes. */
  endMonths: number;
  fteMonths: number;
  /** Never finishes — some demanded capability has no pool or no ceiling. */
  isImpossible: boolean;
  impossibleReasons: ImpossibleReason[];
  /** Finishes, but its derived crew for some capability is bigger than that
   *  capability's whole pool, so it always runs under strength. */
  isOverPool: boolean;
  overPoolCapabilities: Capability[];
  /** Sum of the row's assigned days — the effort this schedule was actually
   *  built from. Feed it to `effortDrift` with the project's T-shirt size to
   *  see whether the two still agree. */
  assignedEffortDays: number;
  /** Row sums to 0 — nothing to schedule, not an error. */
  hasNoDemand: boolean;
  /** Months from t=0 this project was externally barred from starting before;
   *  0 when unconstrained. Echoed back so the UI can separate "not allowed to
   *  start yet" from "waiting for people", which look identical on a bar but
   *  mean opposite things about what to do next. */
  earliestStartMonths: number;
  waits: WaitSpan[];
  /** How much later this project's bar starts than it would have with no
   *  contiguity enforcement at all (the very first, `releaseAt`-free pass) —
   *  diagnostic instrumentation for `simulateCapabilitySchedule`'s fixed
   *  point, not a scheduling input. 0 for anything the mechanism never
   *  touched (single-phase, impossible, or simply never gapped). Watch this
   *  before "fixing" the fixed point's monotone-only pushes: if it's
   *  negligible across a real backlog, the pessimism those pushes can in
   *  theory introduce isn't costing anything in practice. */
  contiguityDelayMonths: number;
}

// A stretch where a capability's pool is bigger than the sum of what running
// projects asked for, so `idleFte` has nothing to do.
export interface IdleSpan {
  capability: Capability;
  startMonths: number;
  endMonths: number;
  idleFte: number;
}

// FTE released by a finishing stream and picked up by one that was still
// short of its target — `atMonths` is both the moment the first ends and the
// point on the receiver's bar where the extra FTE lands.
export interface CapacityTransfer {
  capability: Capability;
  atMonths: number;
  fromProjectId: string;
  toProjectId: string;
  fte: number;
}

export interface CapabilitySchedule {
  /** In backlog order. Impossible / no-demand projects are included with
   *  empty segments so the UI can still render a row for them. */
  scheduled: ScheduledProject[];
  idleSpans: IdleSpan[];
  transfers: CapacityTransfer[];
  pools: CapabilityVector;
  /** Max finite `endMonths` across scheduled projects. */
  horizonMonths: number;
  idleFteMonths: CapabilityVector;
  /** Demanded-but-unfunded FTE-months per capability — "how short is each
   *  specialisation, and by how much". */
  shortfallFteMonths: CapabilityVector;
  /** Hit the iteration safety net — a real bug, not a slow plan. */
  truncated: boolean;
}

export interface SimulateInput {
  /** Global backlog order. */
  projects: Project[];
  cells: Record<string, Record<Capability, CapabilityCell>>;
  /** Headcount FTE per capability. Deliberately the same unit as a phase's
   *  derived crew: the crew test compares one against the other, so a pool
   *  quietly rescaled into "productive FTE" would make every phase look
   *  under-staffed against crews that are still counting people. */
  pools: CapabilityVector;
  /** Days of estimate one FTE of each capability delivers per month —
   *  `effectiveDaysByCapability(people, settings)`. Per capability rather than
   *  one figure because productivity is set per person, and the people behind
   *  BE are not the people behind UX. */
  effectiveDaysPerMonth: CapabilityVector;
  /** Fraction of a phase's derived crew that counts as the smallest team able
   *  to make honest progress on it, 0 < f <= 1. Drives both the gang-start
   *  test and the floor a running crew is never allowed to drop below. */
  minStaffingFraction: number;
  /** FTE below which a capability runs as a burst rather than being de-rated
   *  across its whole phase. Defaults to `DEFAULT_MIN_CREW_FTE`. */
  minCrewFte?: number;
  /** Months from t=0 before which a project may not start at all, by project
   *  id. An external fact — a contract date, a budget year — so unlike every
   *  other wait in here it is not something better planning could shorten.
   *  Missing or <= 0 means "available now", which is the default for all of
   *  them. Callers convert calendar months to this offset (see lib/calendar). */
  earliestStart?: Record<string, number>;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function mergeAdjacentSegments(segments: StreamSegment[]): StreamSegment[] {
  const merged: StreamSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.fte - seg.fte) < EPS && Math.abs(last.endMonths - seg.startMonths) < EPS) {
      last.endMonths = seg.endMonths;
      last.isFullyStaffed = last.isFullyStaffed && seg.isFullyStaffed;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

function mergeIdleSpans(spans: IdleSpan[]): IdleSpan[] {
  const merged: IdleSpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.capability === span.capability &&
      Math.abs(last.idleFte - span.idleFte) < EPS &&
      Math.abs(last.endMonths - span.startMonths) < EPS
    ) {
      last.endMonths = span.endMonths;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function sameCapabilities(a: Capability[], b: Capability[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((c) => setB.has(c));
}

function mergeWaitSpans(spans: WaitSpan[]): WaitSpan[] {
  const merged: WaitSpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.reason === span.reason &&
      Math.abs(last.endMonths - span.startMonths) < EPS &&
      sameCapabilities(last.capabilities, span.capabilities)
    ) {
      last.endMonths = span.endMonths;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

export interface LaneAssigned {
  startMonths: number;
  endMonths: number;
  lane: number;
}

// One lane per item, never shared: items are ranked by start time (ties keep
// their original order) and the rank *is* the lane. Returns lanes parallel to
// the input array.
export function assignOwnLanes(items: { startMonths: number }[]): number[] {
  const laneByIndex = new Array<number>(items.length);
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.startMonths - b.item.startMonths || a.index - b.index)
    .forEach(({ index }, rank) => {
      laneByIndex[index] = rank;
    });
  return laneByIndex;
}

/** Every project whose faza 2 didn't pick up the instant faza 1 finished,
 *  paired with the faza 1 start that closes its gap: hold initiation back by
 *  exactly the gap that followed it and it lands exactly where faza 2 begins.
 *  A non-empty result is a violation of the contiguity invariant, not an
 *  optimisation opportunity — every entry here must be closed before the
 *  schedule can be returned. */
function phaseGaps(schedule: CapabilitySchedule): { id: string; releaseAt: number }[] {
  const out: { id: string; releaseAt: number }[] = [];
  for (const sp of schedule.scheduled) {
    const p1 = sp.phases.find((p) => p.phase === 1);
    const p2 = sp.phases.find((p) => p.phase === 2);
    if (!p1 || !p2 || !Number.isFinite(p2.startMonths)) continue;
    const gap = p2.startMonths - p1.endMonths;
    if (gap <= EPS) continue;
    out.push({ id: sp.project.id, releaseAt: p1.startMonths + gap });
  }
  return out;
}

/** Safety net for the convergence loop below, not a search budget: every
 *  round either returns a gap-free schedule or strictly increases at least
 *  one project's `releaseAt` (see `phaseGaps`), so the loop terminates in a
 *  number of rounds bounded by how many distinct projects can end up
 *  interposing on each other's capacity across the backlog. Hitting this cap
 *  means the fixed point failed to settle — a bug (e.g. a contention cycle),
 *  not a plan that's merely slow to converge — and is reported as
 *  `truncated` rather than returned with a gap the invariant forbids. */
const MAX_CONTIGUITY_ROUNDS = 200;

/**
 * Schedules the backlog under a hard constraint: every project whose demand
 * spans both phases has its faza 2 pick up in the same instant faza 1 ends.
 * The only shape a finished project's bar can have is `waiting -> faza 1 ->
 * faza 2`; `faza 1 -> waiting gap -> faza 2` never appears in the result.
 * This is not a layout nicety — there is no point tying up PM, UX and TL
 * effort on initiation before the build crew it hands off to is actually
 * available, so a project that cannot immediately follow faza 1 with faza 2
 * must not open faza 1 at all yet. It waits, whole, instead.
 *
 * `simulateOnce` cannot decide this on its own: whether faza 2's crew will be
 * free the instant faza 1 finishes depends on every other project's
 * schedule, which can in turn depend on this one's — a project delayed to
 * preserve its own contiguity can free (or occupy) exactly the window another
 * project needed for the same reason. So the invariant is enforced by
 * iterating `simulateOnce` to a fixed point rather than checked once: each
 * round finds every project whose faza 2 still had to wait (`phaseGaps`) and
 * pushes its faza 1 no earlier than the point that would close that gap —
 * `releaseAt`, the same "not before" floor `notBefore` already applies to
 * faza 1 alone. That push is a floor, not a directive to open at that exact
 * instant: gang start, sticky holds, backfill, anti-starvation, `blockedBy`
 * and `earliestStart` all still govern whether a phase actually admits its
 * crew, so a project can end up opening faza 1 later than its own pushed
 * release if the rest of the backlog demands it. The next round re-measures
 * the fresh simulation rather than assuming the gap closed exactly as
 * predicted, and pushes again if it didn't.
 *
 * Every push is monotone — a project's release only ever moves later, never
 * back — so the fixed point is reached in a bounded number of rounds (see
 * `MAX_CONTIGUITY_ROUNDS`). An impossible project never enters `phaseGaps`
 * (it has no phases at all in the output) and stays impossible; a project
 * whose demand touches only one phase has nothing to be contiguous with and
 * is likewise never a candidate.
 *
 * Monotone-only growth is what makes the fixed point simple to reason about,
 * but it can overshoot: project A's push can free (or occupy) capacity that
 * changes what project B actually needs, and by the time that's visible B's
 * own push has already been set from an earlier, since-stale measurement —
 * with no mechanism to reconsider it, that excess sits in the plan forever.
 * `relaxReleases` runs once the forward pass settles and tries shrinking
 * each applied release back down (binary search against "is the whole
 * schedule still gap-free"), keeping a reduction only when it genuinely
 * still holds. This is a *local* cleanup, not a re-derivation of the
 * minimum — order-dependent and not guaranteed globally optimal — but it
 * directly targets the overshoot instead of leaving every push exactly as
 * large as its first, worst-case measurement.
 */
export function simulateCapabilitySchedule(input: SimulateInput): CapabilitySchedule {
  const release = new Map<string, number>();
  // The un-pushed baseline — the only thing that makes `contiguityDelayMonths`
  // meaningful, since it's the sole point of comparison for "how much did
  // enforcing contiguity move this project."
  const baseline = simulateOnce(input, release);
  let result = baseline;

  for (let round = 0; !result.truncated; round++) {
    const gaps = phaseGaps(result);
    if (gaps.length === 0) break;
    if (round >= MAX_CONTIGUITY_ROUNDS) {
      result = { ...result, truncated: true };
      break;
    }
    for (const g of gaps) release.set(g.id, g.releaseAt);
    result = simulateOnce(input, release);
  }

  if (result === baseline) return result;
  if (!result.truncated) result = relaxReleases(input, release, result);
  return { ...result, scheduled: withContiguityDelay(result.scheduled, baseline.scheduled) };
}

/** Hard cap on bisection depth per project. A backstop only — the precision
 *  threshold below normally ends the loop first. */
const MAX_RELAX_BISECT_STEPS = 20;

/** Stop bisecting once a release is pinned to within a twentieth of a month —
 *  about one working day.
 *
 *  This is a latency knob, not a cosmetic one. Every halving costs a full
 *  re-simulation of the entire backlog, so the old `> EPS` (1e-9) condition
 *  ran all 20 steps for every released project: ~380 whole-plan simulations
 *  per schedule, and a schedule is recomputed on every edit.
 *
 *  Measured against the exact search on the live backlog: the horizon is
 *  identical to five decimal places and no project's end moves by as much as
 *  a day — finer than the effort estimates feeding it, which are whole days
 *  at best. Tighten it only with a matching latency budget: 1e-9 costs ~670ms
 *  a schedule, 0.05 costs ~270ms. */
const RELAX_PRECISION_MONTHS = 0.05;

/** Tries to shrink every release the forward pass applied, largest first, so
 *  the projects that were pushed the most (and so most likely overshot once
 *  the backlog settled) get first crack at reclaiming an earlier start.
 *  Mutates `release` in place; returns the schedule for whatever the final,
 *  possibly-reduced map produces. */
function relaxReleases(
  input: SimulateInput,
  release: Map<string, number>,
  current: CapabilitySchedule,
): CapabilitySchedule {
  const ids = [...release.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  for (const id of ids) {
    const original = release.get(id)!;
    if (original <= EPS) continue;

    const stillValid = (candidate: number) => {
      const trial = new Map(release);
      trial.set(id, candidate);
      const trialResult = simulateOnce(input, trial);
      return !trialResult.truncated && phaseGaps(trialResult).length === 0 ? trialResult : null;
    };

    const droppedEntirely = stillValid(0);
    if (droppedEntirely) {
      release.delete(id);
      current = droppedEntirely;
      continue;
    }

    let lo = 0; // last known-bad
    let hi = original; // last known-good
    let best = current;
    for (let step = 0; step < MAX_RELAX_BISECT_STEPS && hi - lo > RELAX_PRECISION_MONTHS; step++) {
      const mid = (lo + hi) / 2;
      const midResult = stillValid(mid);
      if (midResult) {
        hi = mid;
        best = midResult;
      } else {
        lo = mid;
      }
    }
    if (hi < original - EPS) {
      release.set(id, hi);
      current = best;
    }
  }

  return current;
}

function withContiguityDelay(scheduled: ScheduledProject[], baseline: ScheduledProject[]): ScheduledProject[] {
  return scheduled.map((sp, i) => {
    const before = baseline[i]?.startMonths;
    const delay =
      Number.isFinite(sp.startMonths) && before != null && Number.isFinite(before)
        ? sp.startMonths - before
        : 0;
    return delay > EPS ? { ...sp, contiguityDelayMonths: delay } : sp;
  });
}

/**
 * Priority-based variable-rate allocation across seven independent capability
 * pools, with each project gated through two phases: faza 1 (inicjacja — 20%
 * of PM and TL effort, plus all UX) must fully complete before faza 2
 * (wytwarzanie — BE/FE/QA/SEC and the remaining 80% of PM and TL) can start.
 *
 * Each phase runs a **crew**, not a set of independently paced streams: the
 * cells give a ceiling per capability, and `lib/crew.ts` derives from it the
 * FTE each capability actually runs at so that every one of them finishes on
 * the same day. Whichever capability is pinned at its own ceiling sets the
 * length; the rest de-rate onto it. Only a stream held at the `minCrewFte`
 * floor (too little work to spread across the phase honestly) may finish
 * early.
 *
 * Three rules shape the allocation, and between them they guarantee that a
 * phase, once begun, runs without gaps to its end:
 *
 * 1. **Gang start.** A phase doesn't open until *every* capability it demands
 *    can be staffed at its minimum simultaneously (`crewFte *
 *    minStaffingFraction`). A phase that can't be staffed takes nothing at
 *    all rather than starting a couple of its streams and stalling. Capacity
 *    it can't use cascades down the backlog to the next project that *can*
 *    open — the backfill that keeps this from wasting the pool.
 *
 * 2. **The crew moves as one.** Both at gang start and on every later top-up,
 *    the whole team is scaled by a single common factor (`crewScale`) rather
 *    than each capability taking what it can get. Short of capacity the phase
 *    simply takes proportionally longer. Allocating per capability would let
 *    a well-supplied stream sprint ahead of a starved sibling and pull the
 *    phase's streams apart again — the one thing the derivation exists to
 *    prevent.
 *
 * 3. **Sticky, non-preemptive holds.** Once a phase opens, each of its
 *    streams holds its FTE until that stream completes. A higher-ranked
 *    project arriving later draws only on genuinely free capacity; it can no
 *    longer pull people off work already under way.
 *
 * Rank still dominates: each slice walks the backlog in order, topping up
 * open streams towards their target and admitting closed ones, so free
 * capacity always reaches the highest-ranked project that can use it. To stop
 * any project from being starved by smaller ones slipping in ahead of it,
 * *every* project that fails its crew test this slice — not just the very
 * first — reserves its own *future* start instead of today's capacity: the
 * earliest instant its own committed-work lookahead says every capability it
 * needs will clear its minimum (see the reservation block in `simulateOnce`
 * for how). A lower-ranked candidate may still open on idle capacity, but
 * only if it would vacate before *every* reservation that also claims that
 * capability — so idle-but-not-yet-useful capacity still goes to lower ranks
 * rather than sitting empty, without one failing project's silence letting a
 * different one get starved by something even lower-ranked.
 *
 * TL's phase-2 share used to be a "residue" exempt from rules 1 and 3, re-paced
 * every slice off the project's other live phase-2 streams so it landed
 * alongside them. Deriving every capability's crew from its phase does that
 * for all seven at once, so the exemption is gone: TL is now an ordinary crew
 * stream with a real minimum, like PM's phase-2 share and BE/FE/QA/SEC.
 *
 * A project with `project.blockedBy` set draws nothing from any pool — not
 * even its own phase 1 — until its blocker's overall end (both phases, if
 * it has two). A blocker that never finishes makes every project it blocks
 * impossible too, transitively. A `blockedBy` cycle (including a project
 * blocking itself) is invalid planning data rather than something the
 * scheduler may repair: every project on the cycle is excluded outright
 * (`dependency-cycle`, naming the whole cycle) and anything that depends on
 * a cycle member is excluded transitively — no edge is ever dropped or
 * reinterpreted to make a schedule possible.
 *
 * `releaseAt` (project id → months) additionally holds a project's faza 1 shut
 * until that moment. It is the lever `simulateCapabilitySchedule` uses to make
 * the phases contiguous; on a first, unconstrained run it is empty.
 */
function simulateOnce(input: SimulateInput, releaseAt: Map<string, number>): CapabilitySchedule {
  const { projects, cells, pools } = input;
  // A zero fraction would make the crew test vacuous — every stream clears a
  // floor of zero — which combined with sticky holds would "open" phases at
  // zero staffing and never move them. Clamp into a range where both rules
  // stay meaningful.
  const minFraction = Math.min(1, Math.max(EPS, input.minStaffingFraction));
  const minCrewFte = Math.max(0, input.minCrewFte ?? DEFAULT_MIN_CREW_FTE);
  const n = projects.length;
  const capIndex = new Map<Capability, number>(CAPABILITY_ORDER.map((c, i) => [c, i]));
  const phase1CapIndexes = PHASE_1_CAPABILITIES.map((c) => capIndex.get(c)!);
  const phase2CapIndexes = PHASE_2_CAPABILITIES.map((c) => capIndex.get(c)!);
  const poolByIndex = CAPABILITY_ORDER.map((c) => pools[c] ?? 0);
  // Indexed the same way as every other per-capability array in here, so a
  // rate is always read with the `k` already in hand.
  const EDPM = CAPABILITY_ORDER.map((c) => input.effectiveDaysPerMonth[c] ?? 0);

  // ---- 1. build demand -----------------------------------------------------
  const assignedDays: number[][] = [];
  const maxFte: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = cells[projects[i].id];
    const days = new Array(CAPABILITY_ORDER.length).fill(0);
    const ceiling = new Array(CAPABILITY_ORDER.length).fill(0);
    CAPABILITY_ORDER.forEach((capability, k) => {
      const cell = row?.[capability];
      days[k] = cell?.days ?? 0;
      ceiling[k] = cell?.maxFte ?? 0;
    });
    assignedDays.push(days);
    maxFte.push(ceiling);
  }

  const assignedSum = assignedDays.map((days) => sum(days));
  const hasNoDemand = assignedSum.map((s) => s <= EPS);

  // rem1 = phase-1 remaining days per capability (only PM/UX/TL meaningful).
  // rem2 = phase-2 remaining days per capability (BE/FE/QA/SEC and PM as
  // normal crew streams, plus the TL residue).
  const rem1: number[][] = [];
  const rem2: number[][] = [];
  for (let i = 0; i < n; i++) {
    const r1 = new Array(CAPABILITY_ORDER.length).fill(0);
    const r2 = new Array(CAPABILITY_ORDER.length).fill(0);
    CAPABILITY_ORDER.forEach((capability, k) => {
      const eff = assignedDays[i][k];
      if (eff <= MIN_STREAM_DAYS) return;
      if (SPLIT_CAPABILITIES.includes(capability)) {
        r1[k] = eff * PHASE_1_SPLIT_SHARE;
        r2[k] = eff * (1 - PHASE_1_SPLIT_SHARE);
      } else if (PHASE_1_CAPABILITIES.includes(capability)) {
        r1[k] = eff;
      } else {
        r2[k] = eff;
      }
    });
    rem1.push(r1);
    rem2.push(r2);
  }

  // ---- 1b. derive each phase's crew ----------------------------------------
  // The cells give a ceiling per capability; the crew that actually runs is
  // derived from it, per phase, so every stream in a phase finishes together
  // (see `lib/crew.ts`). Phase 1 and phase 2 get their own crews — PM's 20%
  // up front is a different-shaped job from its 80% during the build, and a
  // single figure for both could only ever be wrong for one of them.
  const crew1: DerivedCrew[] = [];
  const crew2: DerivedCrew[] = [];
  for (let i = 0; i < n; i++) {
    crew1.push(deriveCrew(rem1[i], maxFte[i], EDPM, minCrewFte));
    crew2.push(deriveCrew(rem2[i], maxFte[i], EDPM, minCrewFte));
  }

  // ---- 2. impossibility pre-pass -------------------------------------------
  // A stream with effort but no pool, no target, or a minimum its pool can
  // never cover never finishes. Such a project is excluded from the
  // simulation entirely — otherwise it would squat on every capability it
  // *does* have forever (or, under gang start, hold a reservation nothing can
  // ever fill), starving every lower ranked project of everything, and the
  // whole chart would be garbage.
  const impossibleReasons: ImpossibleReason[][] = Array.from({ length: n }, () => []);
  const overPoolCapabilities: Capability[][] = Array.from({ length: n }, () => []);
  const excluded = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    CAPABILITY_ORDER.forEach((capability, k) => {
      const demand = rem1[i][k] + rem2[i][k];
      if (demand <= MIN_STREAM_DAYS) return;
      const pool = poolByIndex[k];
      const ceiling = maxFte[i][k];
      if (pool <= EPS) {
        impossibleReasons[i].push({ capability, kind: "no-pool" });
        excluded[i] = true;
      }
      if (ceiling <= EPS) {
        impossibleReasons[i].push({ capability, kind: "no-max" });
        excluded[i] = true;
      }
      // Judged on the *derived* crew, not the ceiling: a capability capped at
      // 2 that only ever runs at 0.3 because something else sets the pace is
      // perfectly schedulable against a pool of 1. Checking the ceiling here
      // would condemn projects the simulation would have had no trouble with.
      // Each phase is checked on its own crew, since they differ.
      const worstCrew = Math.max(
        rem1[i][k] > MIN_STREAM_DAYS ? crew1[i].fte[k] : 0,
        rem2[i][k] > MIN_STREAM_DAYS ? crew2[i].fte[k] : 0,
      );
      if (pool > EPS && ceiling > EPS && worstCrew * minFraction > pool + EPS) {
        impossibleReasons[i].push({ capability, kind: "min-above-pool" });
        excluded[i] = true;
      }
      if (worstCrew > pool + EPS) overPoolCapabilities[i].push(capability);
    });
  }

  // blockedBy: a project cannot start (either phase) until its blocker fully
  // ends. Each project has at most one blocker, so this graph is a
  // "functional graph" — every node has out-degree <= 1 — which decomposes
  // into trees hanging off of chains that either dangle (no blocker) or loop
  // back on themselves. A loop is invalid planning data, not something the
  // scheduler is entitled to fix: no edge is dropped, ignored, or
  // reinterpreted to make a schedule possible. A project blocking itself
  // counts as the smallest possible cycle.
  const idIndex = new Map(projects.map((p, i) => [p.id, i]));
  const blockerOf = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const blockerId = projects[i].blockedBy;
    if (!blockerId) continue;
    const b = idIndex.get(blockerId);
    if (b == null) continue;
    blockerOf[i] = b;
  }

  // Standard cycle detection over a functional graph: walk each unvisited
  // node's chain, marking nodes "in progress" as we go. Reaching a node
  // that's already "in progress" closes a cycle made of exactly the nodes
  // walked since it was first seen; reaching one already "done" (settled by
  // an earlier walk) or a dangling end (-1) proves this walk's nodes feed
  // into something else and aren't on a cycle themselves.
  const UNVISITED = 0,
    IN_PROGRESS = 1,
    SETTLED = 2;
  const nodeState = new Array<number>(n).fill(UNVISITED);
  for (let i = 0; i < n; i++) {
    if (nodeState[i] !== UNVISITED) continue;
    const path: number[] = [];
    let cur = i;
    while (cur !== -1 && nodeState[cur] === UNVISITED) {
      nodeState[cur] = IN_PROGRESS;
      path.push(cur);
      cur = blockerOf[cur];
    }
    if (cur !== -1 && nodeState[cur] === IN_PROGRESS) {
      const cycle = path.slice(path.indexOf(cur));
      const cycleIds = cycle.map((idx) => projects[idx].id);
      for (const idx of cycle) {
        excluded[idx] = true;
        impossibleReasons[idx].push({ kind: "dependency-cycle", cycle: cycleIds });
      }
    }
    for (const idx of path) nodeState[idx] = SETTLED;
  }

  // Transitive impossibility: a project blocked, directly or through a
  // chain, by one that never finishes (including any project excluded above
  // for sitting on a cycle) can never start either. The graph outside
  // cycles is now provably acyclic, so this walk always terminates, but the
  // guard against revisiting a node costs nothing and stays as a safety net.
  for (let i = 0; i < n; i++) {
    if (excluded[i]) continue;
    const seen = new Set<number>([i]);
    let cur = blockerOf[i];
    while (cur !== -1 && !seen.has(cur)) {
      if (excluded[cur]) {
        excluded[i] = true;
        impossibleReasons[i].push({ kind: "blocked-by-impossible" });
        break;
      }
      seen.add(cur);
      cur = blockerOf[cur];
    }
  }

  // ---- 3. simulate the active (non-excluded, non-empty) projects ----------
  const activeIdx: number[] = [];
  for (let i = 0; i < n; i++) if (!excluded[i] && !hasNoDemand[i]) activeIdx.push(i);
  const m = activeIdx.length;
  const localIndexOf = new Map(activeIdx.map((i, j) => [i, j]));
  // A blocker with no demand of its own finishes instantly, so there's
  // nothing to wait for; a blocker excluded for its own reasons can't occur
  // here — the propagation above would have excluded `i` too.
  const blockerLocalIdx = activeIdx.map((i) => {
    const b = blockerOf[i];
    if (b === -1 || hasNoDemand[b]) return -1;
    return localIndexOf.get(b) ?? -1;
  });
  const releaseByLocal = activeIdx.map((i) => releaseAt.get(projects[i].id) ?? 0);
  const earliestByLocal = activeIdx.map((i) =>
    Math.max(0, input.earliestStart?.[projects[i].id] ?? 0),
  );

  const R1 = activeIdx.map((i) => rem1[i].slice());
  const R2 = activeIdx.map((i) => rem2[i].slice());
  const TGT1 = activeIdx.map((i) => crew1[i].fte.slice());
  const TGT2 = activeIdx.map((i) => crew2[i].fte.slice());

  const DONE = 3 as const;
  const phase = new Array<1 | 2 | typeof DONE>(m);
  const phase1Has = new Array<boolean>(m);
  const phase2Has = new Array<boolean>(m);
  const phase1End = new Array<number | null>(m).fill(null);
  const phase2End = new Array<number | null>(m).fill(null);
  // When each phase actually opened its crew — under gang start this is later
  // than "as soon as it was allowed to", so it can't be inferred from the
  // phase gate the way it used to be.
  const phase1Start = new Array<number | null>(m).fill(null);
  const phase2Start = new Array<number | null>(m).fill(null);

  for (let j = 0; j < m; j++) {
    phase1Has[j] = sum(R1[j]) > EPS;
    phase2Has[j] = sum(R2[j]) > EPS;
    phase[j] = phase1Has[j] ? 1 : 2;
    if (!phase1Has[j]) phase1End[j] = 0;
  }

  /** This project's derived crew for the phase it is in right now. Both
   *  phases have their own, so neither can be read without knowing which. */
  function tgt(j: number, k: number): number {
    return phase[j] === 1 ? TGT1[j][k] : TGT2[j][k];
  }
  function minOf(j: number, k: number): number {
    return tgt(j, k) * minFraction;
  }

  /**
   * The fraction of its own crew a project can field right now, given what it
   * already holds plus what is free. Capped at 1 — nobody is over-crewed.
   *
   * This is the crew model's whole allocation rule. Everyone moves together:
   * short of capacity, the *entire* team de-rates by one common factor and
   * the phase simply takes proportionally longer, rather than some streams
   * running at full speed while others stall. That is what keeps a phase's
   * streams finishing on the same day, which is the property the whole model
   * exists to provide — allocating per capability would let them drift apart
   * again the moment the pool got tight.
   */
  function crewScale(j: number, caps: number[], freeFor: (k: number) => number): number {
    let scale = 1;
    for (const k of caps) {
      const want = tgt(j, k);
      if (want <= EPS) continue;
      scale = Math.min(scale, (held[j][k] + freeFor(k)) / want);
    }
    return Math.max(0, scale);
  }

  // The gang-started, sticky part of a phase: every capability it still owes
  // work on. Both split capabilities' phase-2 shares are ordinary crew here
  // — the TL residue that used to be exempt is gone (see SPLIT_CAPABILITIES).
  function crewCapsOf(j: number): number[] {
    const caps: number[] = [];
    if (phase[j] === 1) {
      for (const k of phase1CapIndexes) if (R1[j][k] > EPS) caps.push(k);
    } else if (phase[j] === 2) {
      for (const k of phase2CapIndexes) if (R2[j][k] > EPS) caps.push(k);
    }
    return caps;
  }

  /**
   * The moment a project may next take capacity. Two bars, different natures:
   * the external earliest start applies to the project as a whole and is not
   * ours to move, while the contiguity pass's deferral applies only while the
   * project is still in faza 1 — that lever exists purely to slide initiation
   * up against the build, so phase 2 drops it and keeps only the external bar.
   */
  function notBefore(j: number): number {
    return phase[j] === 1 ? Math.max(earliestByLocal[j], releaseByLocal[j]) : earliestByLocal[j];
  }

  const segments1: StreamSegment[][][] = Array.from({ length: m }, () =>
    CAPABILITY_ORDER.map(() => []),
  );
  const segments2: StreamSegment[][][] = Array.from({ length: m }, () =>
    CAPABILITY_ORDER.map(() => []),
  );
  const rollup: StreamSegment[][] = Array.from({ length: m }, () => []);
  const rawWaits: WaitSpan[][] = Array.from({ length: m }, () => []);
  const transfers: CapacityTransfer[] = [];
  const idleAcc: IdleSpan[][] = CAPABILITY_ORDER.map(() => []);
  const idleFteMonthsAcc = new Array(CAPABILITY_ORDER.length).fill(0);
  const shortfallFteMonthsAcc = new Array(CAPABILITY_ORDER.length).fill(0);

  let t = 0;
  // FTE each stream currently holds — the persistent state that makes
  // allocation sticky. Zeroed the instant a stream finishes or its phase
  // flips, so `pool - sum(held)` is always exactly the free capacity.
  const held: number[][] = Array.from({ length: m }, () => new Array(CAPABILITY_ORDER.length).fill(0));
  const isOpen = new Array<boolean>(m).fill(false);
  let freedLastSlice: { j: number; k: number; fte: number }[] = [];
  // Every slice either forces a stream to zero — a project has at most 9 (PM
  // and TL twice each, UX, BE, FE, QA, SEC) — or advances to a `notBefore`
  // boundary, of which a project has at most two (its faza 1 deferral and its
  // external earliest start, which can bind again in faza 2). Each fires once,
  // since `t` only ever moves forward.
  const maxIterations = 12 * n + 16;
  let iteration = 0;
  let truncated = false;

  function releaseHeld(j: number) {
    held[j].fill(0);
    isOpen[j] = false;
  }

  while (true) {
    // "remaining" (unfinished) drives termination; "notDone" (unfinished AND
    // not still held by a blocker) is who actually competes for pools this
    // slice. A root of any blockedBy chain has no blocker of its own, so
    // notDone is never empty while remaining still has projects in it.
    const remaining: number[] = [];
    for (let j = 0; j < m; j++) if (phase[j] !== DONE) remaining.push(j);
    if (remaining.length === 0) break;
    if (iteration >= maxIterations) {
      truncated = true;
      break;
    }
    iteration++;

    const notDone = remaining.filter((j) => {
      const bj = blockerLocalIdx[j];
      if (bj !== -1 && phase[bj] !== DONE) return false;
      // Held back either by an external earliest start or by the contiguity
      // pass sliding faza 1 up against faza 2 — see `notBefore`.
      if (t < notBefore(j) - EPS) return false;
      return true;
    });

    const desired: number[][] = Array.from({ length: m }, () => new Array(CAPABILITY_ORDER.length).fill(0));

    const poolLeft = poolByIndex.slice();
    for (const j of remaining) {
      for (let k = 0; k < CAPABILITY_ORDER.length; k++) poolLeft[k] -= held[j][k];
    }

    for (const j of notDone) {
      for (const k of crewCapsOf(j)) desired[j][k] = tgt(j, k);
    }

    // The future moment capability `k` will next hold at least `minNeeded`
    // free, found by a small lookahead simulation of only currently-
    // committed sticky holders (every project in `notDone` other than
    // `forJ`) — no new admissions, exactly like the real slice loop but
    // restricted to work already under way. As each committed holder's
    // bucket empties, its FTE returns to the pool and is redistributed to
    // whoever's still running and under target, in rank order, precisely
    // like the real top-up rule (3b's `isOpen` branch) — a holder ranked
    // above `forJ` gets first claim (mirroring the real per-slice walk),
    // and only what's left after that counts toward `forJ`'s own threshold.
    // A committed holder can therefore finish *earlier* than its current
    // rate implies, because it will run faster once topped up — treating
    // today's rate as constant (the old approach) systematically predicts a
    // later, more pessimistic readiness than the real schedule delivers.
    function futureReadyAt(forJ: number, k: number, minNeeded: number): number {
      let free = Math.max(0, poolLeft[k]);
      if (free >= minNeeded - EPS) return t;

      // `notDone` is already in backlog rank order, so array order below
      // doubles as priority order for redistribution.
      const holders = notDone
        .filter((owner) => owner !== forJ && held[owner][k] > EPS)
        .map((owner) => ({
          rank: owner,
          rate: held[owner][k],
          remaining: (phase[owner] === 1 ? R1[owner] : R2[owner])[k],
          target: tgt(owner, k),
        }));

      let horizon = t;
      while (holders.length > 0) {
        let dt = Infinity;
        for (const h of holders) dt = Math.min(dt, h.remaining / (h.rate * EDPM[k]));
        for (const h of holders) h.remaining -= h.rate * EDPM[k] * dt;
        horizon += dt;

        let released = 0;
        for (let i = holders.length - 1; i >= 0; i--) {
          if (holders[i].remaining <= EPS) released += holders.splice(i, 1)[0].rate;
        }
        free += released;

        // Holders ranked above `forJ` get first claim on the freed capacity
        // — the real per-slice walk would top them up before ever reaching
        // `forJ`'s position.
        for (const h of holders) {
          if (h.rank >= forJ || free <= EPS) continue;
          const room = h.target - h.rate;
          if (room <= EPS) continue;
          const take = Math.min(room, free);
          h.rate += take;
          free -= take;
        }
        if (free >= minNeeded - EPS) return horizon;

        // `forJ` still isn't ready — the real sim wouldn't leave the rest
        // idle either, so still-open lower-ranked holders may keep it.
        for (const h of holders) {
          if (free <= EPS) break;
          const room = h.target - h.rate;
          if (room <= EPS) continue;
          const take = Math.min(room, free);
          h.rate += take;
          free -= take;
        }
      }
      return free >= minNeeded - EPS ? horizon : Infinity;
    }

    // 3b. One pass down the backlog: top up open streams towards their
    // target, admit closed phases whose whole crew clears its minimum.
    //
    // Every closed phase that *fails* this slice — not just the first —
    // does not withhold today's free capacity; it doesn't need any of it
    // yet. Instead it reserves its *future* start: the earliest instant
    // every capability it needs will simultaneously clear its minimum,
    // given only what's already committed (`futureReadyAt`, maxed across
    // its capabilities since gang start needs them all at once). A
    // lower-ranked project already free to use capacity that a higher-
    // ranked reservation also needs may still open — but only if its own
    // demand for that capacity would finish before *every* reservation
    // that claims it, so it vacates in time rather than becoming a new,
    // unplanned blocker for whichever reservation it would otherwise run
    // into. One reservation per failing project (not just the very first)
    // matters because a project can fail today for a reason unrelated to
    // what a lower-ranked one is about to grab — e.g. #1 is only short on
    // SEC while #2 is short on BE; without #2's own reservation, #3 could
    // freely take BE for months and starve #2 even though #1's SEC-only
    // reservation never objected. This is still bounded anti-starvation
    // (each reservation can only get earlier as committed holders actually
    // finish, never later), it just stops idling capacity nobody ranked
    // above is ready to use yet.
    const reservations: { caps: number[]; readyAt: number }[] = [];
    const crewWaits = new Map<number, Capability[]>();
    const gains: { j: number; k: number; fte: number }[] = [];
    for (const j of notDone) {
      const caps = crewCapsOf(j);
      const freeFor = (k: number) => Math.max(0, poolLeft[k]);

      if (isOpen[j]) {
        // Top up towards the full crew, but uniformly: a running phase comes
        // back up to strength as one team. Letting BE alone reach target
        // while QA stayed short would put their finish dates back out of step.
        const scale = crewScale(j, caps, freeFor);
        for (const k of caps) {
          const take = desired[j][k] * scale - held[j][k];
          if (take <= EPS) continue;
          held[j][k] += take;
          poolLeft[k] -= take;
          gains.push({ j, k, fte: take });
        }
        continue;
      }

      if (caps.every((k) => freeFor(k) >= minOf(j, k) - EPS)) {
        // Safe only if, for every capability any higher-ranked reservation
        // also needs, this project's own draw on it would be done again
        // before *that* reservation — otherwise "free now" would just
        // relocate the starvation instead of using idle time honestly.
        // The crew this project would actually open at, which is what its
        // finish dates have to be judged on — not a per-capability maximum it
        // will never run at, since the whole team moves at one scale.
        const openScale = crewScale(j, caps, freeFor);
        const overlap = new Set<number>();
        for (const res of reservations) {
          for (const k of caps) {
            if (overlap.has(k) || !res.caps.includes(k)) continue;
            const alloc = tgt(j, k) * openScale;
            if (alloc <= EPS) continue;
            const bucket = phase[j] === 1 ? R1[j][k] : R2[j][k];
            const finish = t + bucket / (alloc * EDPM[k]);
            if (finish > res.readyAt + EPS) overlap.add(k);
          }
        }
        if (overlap.size > 0) {
          crewWaits.set(j, [...overlap].map((k) => CAPABILITY_ORDER[k]));
          continue;
        }

        for (const k of caps) {
          const take = tgt(j, k) * openScale;
          held[j][k] = take;
          poolLeft[k] -= take;
        }
        isOpen[j] = true;
        if (phase[j] === 1) phase1Start[j] ??= t;
        else phase2Start[j] ??= t;
      } else {
        crewWaits.set(
          j,
          caps.filter((k) => freeFor(k) < minOf(j, k) - EPS).map((k) => CAPABILITY_ORDER[k]),
        );
        let readyAt = t;
        for (const k of caps) readyAt = Math.max(readyAt, futureReadyAt(j, k, minOf(j, k)));
        reservations.push({ caps: caps.slice(), readyAt });
      }
    }

    // (What used to be 3c — the TL residue's per-slice re-pacing — is gone.
    // Deriving every capability's crew to finish with its phase does the same
    // job for all seven at once, so there is nothing left for it to do.)

    // 3d. Hand freed FTE to whoever ramped up this slice, scoped per
    // capability (a hand-off only makes sense within one pool). Only a top-up
    // counts: a phase opening its crew is a fresh start, not a hand-off, even
    // when the capacity it takes was released a moment earlier.
    if (freedLastSlice.length > 0 && gains.length > 0) {
      const byCapability = new Map<number, { j: number; fte: number }[]>();
      for (const f of freedLastSlice) {
        const list = byCapability.get(f.k) ?? [];
        list.push({ j: f.j, fte: f.fte });
        byCapability.set(f.k, list);
      }
      for (const gain of gains) {
        const sources = byCapability.get(gain.k);
        if (!sources) continue;
        let gained = gain.fte;
        for (const source of sources) {
          if (gained <= EPS) break;
          if (source.fte <= EPS) continue;
          const moved = Math.min(gained, source.fte);
          transfers.push({
            capability: CAPABILITY_ORDER[gain.k],
            atMonths: t,
            fromProjectId: projects[activeIdx[source.j]].id,
            toProjectId: projects[activeIdx[gain.j]].id,
            fte: moved,
          });
          source.fte -= moved;
          gained -= moved;
        }
      }
    }

    // 3e. The only event is a stream reaching zero.
    let dt = Infinity;
    let binding: { j: number; k: number }[] = [];
    for (const j of notDone) {
      const bucket = phase[j] === 1 ? R1[j] : R2[j];
      for (let k = 0; k < CAPABILITY_ORDER.length; k++) {
        if (bucket[k] <= EPS || held[j][k] <= EPS) continue;
        const finish = bucket[k] / (held[j][k] * EDPM[k]);
        if (finish < dt - EPS) {
          dt = finish;
          binding = [{ j, k }];
        } else if (finish < dt + EPS) {
          binding.push({ j, k });
        }
      }
    }
    // A pending release is an event too: without it the clock would jump over
    // the moment a held-back faza 1 becomes admissible. It can also be the
    // *only* event in a slice, which is why termination can't lean on "some
    // stream always closes" alone — see `maxIterations`.
    let nextRelease = Infinity;
    for (const j of remaining) {
      const rel = notBefore(j);
      if (rel > t + EPS) nextRelease = Math.min(nextRelease, rel - t);
    }
    if (nextRelease < dt - EPS) {
      dt = nextRelease;
      binding = []; // nothing finishes at a release; don't force-zero a stream
    }

    if (!Number.isFinite(dt)) break; // nobody funded anywhere — stuck for good

    // 3f. Idle capacity and demanded-but-unfunded shortfall, per capability.
    for (let k = 0; k < CAPABILITY_ORDER.length; k++) {
      if (poolLeft[k] > EPS) {
        idleAcc[k].push({
          capability: CAPABILITY_ORDER[k],
          startMonths: t,
          endMonths: t + dt,
          idleFte: poolLeft[k],
        });
        idleFteMonthsAcc[k] += poolLeft[k] * dt;
      }
      let short = 0;
      for (const j of notDone) short += Math.max(0, desired[j][k] - held[j][k]);
      if (short > EPS) shortfallFteMonthsAcc[k] += short * dt;
    }

    // 3g. A phase that couldn't gather its crew is "crew"-waiting on exactly
    // the capabilities that fell short of their minimum; one that is running
    // but under target is "pool"-waiting. "gate" and "blocked" waits are
    // derived afterwards — they need no simulation, they're definitional.
    for (const j of notDone) {
      const missing = crewWaits.get(j);
      if (missing) {
        rawWaits[j].push({ startMonths: t, endMonths: t + dt, reason: "crew", capabilities: missing });
        continue;
      }
      const caps: Capability[] = [];
      for (let k = 0; k < CAPABILITY_ORDER.length; k++) {
        if (desired[j][k] > EPS && held[j][k] < desired[j][k] - EPS) caps.push(CAPABILITY_ORDER[k]);
      }
      if (caps.length > 0) {
        rawWaits[j].push({ startMonths: t, endMonths: t + dt, reason: "pool", capabilities: caps });
      }
    }

    // 3h. Burn, emit segments, then force-zero the binding streams — this is
    // what guarantees >= 1 stream closes per iteration (hence termination
    // within maxIterations) regardless of float drift.
    for (const j of notDone) {
      const isPhase1 = phase[j] === 1;
      const bucket = isPhase1 ? R1[j] : R2[j];
      const bySeg = isPhase1 ? segments1[j] : segments2[j];
      let totalAlloc = 0;
      let fullyStaffed = true;
      for (let k = 0; k < CAPABILITY_ORDER.length; k++) {
        if (held[j][k] <= EPS) continue;
        totalAlloc += held[j][k];
        if (desired[j][k] > EPS && held[j][k] < desired[j][k] - EPS) fullyStaffed = false;
        bySeg[k].push({
          startMonths: t,
          endMonths: t + dt,
          fte: held[j][k],
          isFullyStaffed: held[j][k] >= desired[j][k] - EPS,
        });
        bucket[k] -= held[j][k] * EDPM[k] * dt;
      }
      if (totalAlloc > EPS) {
        rollup[j].push({ startMonths: t, endMonths: t + dt, fte: totalAlloc, isFullyStaffed: fullyStaffed });
      }
    }

    // A stream that hits zero releases its hold — that freed capacity is what
    // the next slice's top-ups and admissions draw on.
    const finishedNow: { j: number; k: number; fte: number }[] = [];
    for (const { j, k } of binding) {
      const bucket = phase[j] === 1 ? R1[j] : R2[j];
      bucket[k] = 0;
      finishedNow.push({ j, k, fte: held[j][k] });
      held[j][k] = 0;
    }

    freedLastSlice = finishedNow;
    t += dt;

    for (const j of notDone) {
      if (phase[j] === 1 && sum(R1[j]) <= EPS) {
        phase[j] = 2;
        phase1End[j] = t;
        // Phase 2 needs a different crew, so it has to be admitted afresh.
        releaseHeld(j);
      }
      if (phase[j] === 2 && sum(R2[j]) <= EPS) {
        phase[j] = DONE;
        phase2End[j] = t;
        releaseHeld(j);
      }
    }
  }

  // ---- 4. assemble output ---------------------------------------------------
  // Precomputed once so a blocked project's wait span can reference its
  // blocker's overall finish time (needed below, since local index j isn't
  // in scope yet when this project's own turn comes up in the .map()).
  const endByLocal = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    endByLocal[j] = phase2Has[j] ? (phase2End[j] ?? 0) : (phase1End[j] ?? 0);
  }

  /** One stream's output row. Everything a caller can ask about a stream's
   *  intended staffing comes off its phase's derived crew, so this is the one
   *  place that reads it — the four call sites below differ only in which
   *  phase, and whether the project ever actually ran. */
  function streamOf(
    capability: Capability,
    k: number,
    phaseNo: Phase,
    demandDays: number,
    crew: DerivedCrew,
    ceiling: number,
    segments: StreamSegment[],
    fallbackStart: number,
    fallbackEnd: number,
  ): StreamSchedule {
    const crewFte = crew.fte[k];
    return {
      capability,
      phase: phaseNo,
      demandDays,
      crewFte,
      maxFte: ceiling,
      setsPace: crew.paceIndex === k,
      isBurst: crew.burstIndexes.includes(k),
      minFte: crewFte * minFraction,
      segments,
      startMonths: segments[0]?.startMonths ?? fallbackStart,
      endMonths: segments.length > 0 ? segments[segments.length - 1].endMonths : fallbackEnd,
    };
  }

  const scheduled: ScheduledProject[] = projects.map((project, i) => {
    // Per capability, not one division of the total: each capability burns its
    // days at its own people's rate, so a project's FTE-months is the sum of
    // seven separate conversions.
    const baseFteMonths = CAPABILITY_ORDER.reduce(
      (total, _capability, k) =>
        EDPM[k] > 0 ? total + (rem1[i][k] + rem2[i][k]) / EDPM[k] : total,
      0,
    );

    if (excluded[i]) {
      const streams: StreamSchedule[] = [];
      CAPABILITY_ORDER.forEach((capability, k) => {
        if (rem1[i][k] > MIN_STREAM_DAYS) {
          streams.push(streamOf(capability, k, 1, rem1[i][k], crew1[i], maxFte[i][k], [], 0, Infinity));
        }
        if (rem2[i][k] > MIN_STREAM_DAYS) {
          streams.push(streamOf(capability, k, 2, rem2[i][k], crew2[i], maxFte[i][k], [], 0, Infinity));
        }
      });
      return {
        project,
        streams,
        phases: [],
        segments: [],
        startMonths: 0,
        endMonths: Infinity,
        fteMonths: baseFteMonths,
        isImpossible: true,
        impossibleReasons: impossibleReasons[i],
        isOverPool: overPoolCapabilities[i].length > 0,
        overPoolCapabilities: overPoolCapabilities[i],
        assignedEffortDays: assignedSum[i],
        hasNoDemand: false,
        earliestStartMonths: Math.max(0, input.earliestStart?.[project.id] ?? 0),
        waits: [],
        contiguityDelayMonths: 0,
      };
    }

    if (hasNoDemand[i]) {
      return {
        project,
        streams: [],
        phases: [],
        segments: [],
        startMonths: 0,
        endMonths: 0,
        fteMonths: 0,
        isImpossible: false,
        impossibleReasons: [],
        isOverPool: false,
        overPoolCapabilities: [],
        assignedEffortDays: assignedSum[i],
        hasNoDemand: true,
        earliestStartMonths: Math.max(0, input.earliestStart?.[project.id] ?? 0),
        waits: [],
        contiguityDelayMonths: 0,
      };
    }

    const j = activeIdx.indexOf(i);
    const streams: StreamSchedule[] = [];
    CAPABILITY_ORDER.forEach((capability, k) => {
      if (rem1[i][k] > MIN_STREAM_DAYS) {
        const segs = mergeAdjacentSegments(segments1[j][k]);
        streams.push(
          streamOf(capability, k, 1, rem1[i][k], crew1[i], maxFte[i][k], segs, phase1Start[j] ?? 0, phase1End[j] ?? 0),
        );
      }
      if (rem2[i][k] > MIN_STREAM_DAYS) {
        const segs = mergeAdjacentSegments(segments2[j][k]);
        streams.push(
          streamOf(capability, k, 2, rem2[i][k], crew2[i], maxFte[i][k], segs, phase2Start[j] ?? 0, phase2End[j] ?? 0),
        );
      }
    });

    const rollupMerged = mergeAdjacentSegments(rollup[j]);

    // Both spans start when their crew actually gathered, not when the gate
    // in front of them lifted — under gang start those are different moments.
    const phases: PhaseSpan[] = [];
    if (phase1Has[j]) {
      phases.push({ phase: 1, startMonths: phase1Start[j] ?? 0, endMonths: phase1End[j] ?? 0 });
    }
    if (phase2Has[j]) {
      phases.push({
        phase: 2,
        startMonths: phase2Start[j] ?? phase1End[j] ?? 0,
        endMonths: phase2End[j] ?? phase1End[j] ?? 0,
      });
    }
    const end = endByLocal[j];

    const waits: WaitSpan[] = [];
    const blockerJ = blockerLocalIdx[j];
    if (blockerJ !== -1) {
      const blockerEnd = endByLocal[blockerJ];
      if (blockerEnd > EPS) {
        waits.push({ startMonths: 0, endMonths: blockerEnd, reason: "blocked", capabilities: [] });
      }
    }
    // The gate holds phase 2 from the moment phase 1 actually started; before
    // that the project was waiting on its blocker or on its own phase-1 crew,
    // both of which are already reported as their own spans.
    if (phase1Has[j] && phase2Has[j] && (phase1End[j] ?? 0) > EPS) {
      const gateCaps = PHASE_2_CAPABILITIES.filter((c) => rem2[i][capIndex.get(c)!] > MIN_STREAM_DAYS);
      if (gateCaps.length > 0) {
        waits.push({
          startMonths: phase1Start[j] ?? 0,
          endMonths: phase1End[j] ?? 0,
          reason: "gate",
          capabilities: gateCaps,
        });
      }
    }
    waits.push(...mergeWaitSpans(rawWaits[j]));
    waits.sort((a, b) => a.startMonths - b.startMonths);

    return {
      project,
      streams,
      phases,
      segments: rollupMerged,
      startMonths: rollupMerged[0]?.startMonths ?? 0,
      endMonths: end,
      fteMonths: baseFteMonths,
      isImpossible: false,
      impossibleReasons: [],
      isOverPool: overPoolCapabilities[i].length > 0,
      overPoolCapabilities: overPoolCapabilities[i],
      assignedEffortDays: assignedSum[i],
      hasNoDemand: false,
      earliestStartMonths: Math.max(0, input.earliestStart?.[project.id] ?? 0),
      waits,
      // Filled in by `simulateCapabilitySchedule`, which alone knows the
      // gap-free baseline to measure against — `simulateOnce` has no
      // concept of "with contiguity turned off".
      contiguityDelayMonths: 0,
    };
  });

  const idleSpans = CAPABILITY_ORDER.flatMap((_, k) => mergeIdleSpans(idleAcc[k]));
  const horizonMonths = scheduled.reduce(
    (max, s) => (Number.isFinite(s.endMonths) ? Math.max(max, s.endMonths) : max),
    0,
  );

  const idleFteMonths = emptyCapabilityVector();
  const shortfallFteMonths = emptyCapabilityVector();
  CAPABILITY_ORDER.forEach((capability, k) => {
    idleFteMonths[capability] = idleFteMonthsAcc[k];
    shortfallFteMonths[capability] = shortfallFteMonthsAcc[k];
  });

  return {
    scheduled,
    idleSpans,
    transfers,
    pools: { ...pools },
    horizonMonths,
    idleFteMonths,
    shortfallFteMonths,
    truncated,
  };
}
