import type { Project } from "../types";
import {
  EFFECTIVE_DAYS_PER_PERSON_PER_MONTH,
  buildCategoryBars,
  categoryCapacityPerMonth,
  effortDays,
  type TimelineBar,
} from "./estimation";

export interface ScheduleSegment {
  startMonths: number;
  endMonths: number;
  peopleActive: number;
  isFullyStaffed: boolean;
}

export interface ScheduledProject {
  project: Project;
  target: number;
  segments: ScheduleSegment[];
  startMonths: number;
  endMonths: number;
  isImpossible: boolean;
}

// A stretch where the category's pool is bigger than the sum of what the
// running projects asked for, so `idlePeople` have nothing to do.
export interface IdleSegment {
  startMonths: number;
  endMonths: number;
  idlePeople: number;
}

// People released by a finishing project and picked up by one that was still
// short of its target — `atMonths` is both the moment the first ends and the
// point on the receiver's bar where the extra people land.
export interface CapacityTransfer {
  atMonths: number;
  fromProjectId: string;
  toProjectId: string;
  people: number;
}

export interface GradedSchedule {
  scheduled: ScheduledProject[];
  idleSegments: IdleSegment[];
  transfers: CapacityTransfer[];
}

const EPS = 1e-9;

// Priority-based variable-rate allocation: every graded project competes for
// the category's shared pool in rank order every instant. A higher-ranked
// project always gets up to its own target first; whatever's left cascades
// down. A project's rate can only ever hold steady or increase over its
// lifetime — it never decreases, because the only thing that changes over
// time is higher-priority projects finishing and freeing capacity.
export function simulateGradedSchedule(
  gradedProjects: { project: Project; target: number }[],
  totalPeople: number,
): GradedSchedule {
  const n = gradedProjects.length;
  const remainingDays = gradedProjects.map((g) => effortDays(g.project));
  const rawSegments: ScheduleSegment[][] = gradedProjects.map(() => []);
  const rawIdle: IdleSegment[] = [];
  const transfers: CapacityTransfer[] = [];
  const finished = new Array(n).fill(false);
  let currentTime = 0;
  let finishedCount = 0;
  const maxIterations = n * 4 + 10;
  let prevAllocations = new Array(n).fill(0);
  // Who wrapped up at `currentTime`, and how many people they let go.
  let freedLastSlice: { index: number; people: number }[] = [];

  for (let iteration = 0; finishedCount < n && iteration < maxIterations; iteration++) {
    let poolLeft = totalPeople;
    const allocations = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (finished[i]) continue;
      const alloc = Math.min(gradedProjects[i].target, Math.max(poolLeft, 0));
      allocations[i] = alloc;
      poolLeft -= alloc;
    }

    // Hand the people just freed to whoever ramped up this slice, in priority
    // order. A project only ramps up if it was short of its target, so every
    // transfer recorded here lands on an under-staffed project.
    if (freedLastSlice.length > 0) {
      const pool = freedLastSlice.map((f) => ({ ...f }));
      for (let i = 0; i < n; i++) {
        if (finished[i]) continue;
        let gained = allocations[i] - prevAllocations[i];
        if (gained <= EPS) continue;

        // A project going straight from nothing to its full headcount is just
        // the next one starting, not people topping up a short-handed run —
        // still draw from the pool so the rest is attributed correctly, but
        // don't report it as a hand-off.
        const startsAtFullStrength =
          prevAllocations[i] <= EPS && allocations[i] >= gradedProjects[i].target - EPS;

        for (const source of pool) {
          if (gained <= EPS) break;
          if (source.people <= EPS) continue;
          const moved = Math.min(gained, source.people);
          if (!startsAtFullStrength) {
            transfers.push({
              atMonths: currentTime,
              fromProjectId: gradedProjects[source.index].project.id,
              toProjectId: gradedProjects[i].project.id,
              people: moved,
            });
          }
          source.people -= moved;
          gained -= moved;
        }
      }
    }

    let dt = Infinity;
    for (let i = 0; i < n; i++) {
      if (finished[i] || allocations[i] <= 0) continue;
      const rate = allocations[i] * EFFECTIVE_DAYS_PER_PERSON_PER_MONTH;
      dt = Math.min(dt, remainingDays[i] / rate);
    }
    if (!Number.isFinite(dt)) break; // nobody has any allocation — stuck for good

    // Capacity nobody claimed this slice: every unfinished project is already
    // at its target, so the leftover people sit idle until a target is raised.
    if (poolLeft > EPS) {
      rawIdle.push({ startMonths: currentTime, endMonths: currentTime + dt, idlePeople: poolLeft });
    }

    const finishedNow: { index: number; people: number }[] = [];
    for (let i = 0; i < n; i++) {
      if (finished[i] || allocations[i] <= 0) continue;
      const rate = allocations[i] * EFFECTIVE_DAYS_PER_PERSON_PER_MONTH;
      rawSegments[i].push({
        startMonths: currentTime,
        endMonths: currentTime + dt,
        peopleActive: allocations[i],
        isFullyStaffed: allocations[i] >= gradedProjects[i].target - EPS,
      });
      remainingDays[i] -= rate * dt;
      if (remainingDays[i] <= EPS) {
        finished[i] = true;
        finishedCount++;
        finishedNow.push({ index: i, people: allocations[i] });
      }
    }
    freedLastSlice = finishedNow;
    prevAllocations = allocations;
    currentTime += dt;
  }

  const scheduled = gradedProjects.map((g, i) => {
    const segments = mergeAdjacentSegments(rawSegments[i]);
    return {
      project: g.project,
      target: g.target,
      segments,
      startMonths: segments.length ? segments[0].startMonths : 0,
      endMonths: segments.length ? segments[segments.length - 1].endMonths : 0,
      isImpossible: g.target > totalPeople,
    };
  });

  return { scheduled, idleSegments: mergeIdleSegments(rawIdle), transfers };
}

function mergeIdleSegments(segments: IdleSegment[]): IdleSegment[] {
  const merged: IdleSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (
      last &&
      Math.abs(last.idlePeople - seg.idlePeople) < EPS &&
      Math.abs(last.endMonths - seg.startMonths) < EPS
    ) {
      last.endMonths = seg.endMonths;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

function mergeAdjacentSegments(segments: ScheduleSegment[]): ScheduleSegment[] {
  const merged: ScheduleSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (
      last &&
      Math.abs(last.peopleActive - seg.peopleActive) < EPS &&
      Math.abs(last.endMonths - seg.startMonths) < EPS
    ) {
      last.endMonths = seg.endMonths;
    } else {
      merged.push({ ...seg });
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

export interface CategorySchedule {
  laneCount: number;
  graded: (ScheduledProject & { lane: number })[];
  tail: (TimelineBar & { lane: number })[];
  pendingIds: Set<string>;
  idleSegments: IdleSegment[];
  transfers: CapacityTransfer[];
}

// A category only gets the advanced multi-lane treatment once it has a
// graded project — and only a *contiguous* run starting at rank 0 actually
// schedules. A graded project sitting after a gap is "pending": its number is
// set, but it renders in the plain sequential tail like an ungraded one,
// until the gap in front of it is filled.
export function computeCategorySchedule(
  categoryProjects: Project[],
  assignments: Record<string, number>,
  totalPeople: number,
): CategorySchedule | null {
  let prefixEnd = 0;
  while (prefixEnd < categoryProjects.length && assignments[categoryProjects[prefixEnd].id] != null) {
    prefixEnd++;
  }
  if (prefixEnd === 0) return null;

  const gradedInput = categoryProjects
    .slice(0, prefixEnd)
    .map((project) => ({ project, target: assignments[project.id]! }));
  const tailProjects = categoryProjects.slice(prefixEnd);

  const { scheduled, idleSegments, transfers } = simulateGradedSchedule(gradedInput, totalPeople);
  const gradedEnd = scheduled.reduce((max, s) => Math.max(max, s.endMonths), 0);

  const capacityPerMonth = categoryCapacityPerMonth(totalPeople);
  const tailBars = buildCategoryBars(tailProjects, capacityPerMonth).map((bar) => ({
    ...bar,
    startMonths: bar.startMonths + gradedEnd,
    endMonths: bar.endMonths + gradedEnd,
  }));

  // Graded and tail projects share one ordering: every project gets its own
  // lane, top to bottom by whichever starts first.
  const laneByIndex = assignOwnLanes([...scheduled, ...tailBars]);
  const graded = scheduled.map((s, i) => ({ ...s, lane: laneByIndex[i] }));
  const tail = tailBars.map((bar, i) => ({ ...bar, lane: laneByIndex[scheduled.length + i] }));

  const pendingIds = new Set(
    tailProjects.filter((p) => assignments[p.id] != null).map((p) => p.id),
  );

  return {
    laneCount: graded.length + tail.length,
    graded,
    tail,
    pendingIds,
    idleSegments,
    transfers,
  };
}
