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
): ScheduledProject[] {
  const n = gradedProjects.length;
  const remainingDays = gradedProjects.map((g) => effortDays(g.project));
  const rawSegments: ScheduleSegment[][] = gradedProjects.map(() => []);
  const finished = new Array(n).fill(false);
  let currentTime = 0;
  let finishedCount = 0;
  const maxIterations = n * 4 + 10;

  for (let iteration = 0; finishedCount < n && iteration < maxIterations; iteration++) {
    let poolLeft = totalPeople;
    const allocations = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (finished[i]) continue;
      const alloc = Math.min(gradedProjects[i].target, Math.max(poolLeft, 0));
      allocations[i] = alloc;
      poolLeft -= alloc;
    }

    let dt = Infinity;
    for (let i = 0; i < n; i++) {
      if (finished[i] || allocations[i] <= 0) continue;
      const rate = allocations[i] * EFFECTIVE_DAYS_PER_PERSON_PER_MONTH;
      dt = Math.min(dt, remainingDays[i] / rate);
    }
    if (!Number.isFinite(dt)) break; // nobody has any allocation — stuck for good

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
      }
    }
    currentTime += dt;
  }

  return gradedProjects.map((g, i) => {
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

// Greedy interval coloring — the classic "minimum meeting rooms" algorithm.
// Earliest-starting items claim the lowest free lane; a lane is free once its
// last-placed item has ended.
export function assignLanes<T extends { startMonths: number; endMonths: number }>(
  items: T[],
): (T & { lane: number })[] {
  const order = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.startMonths - b.item.startMonths || a.index - b.index);

  const laneEndTimes: number[] = [];
  const laneByIndex = new Array(items.length);

  for (const { item, index } of order) {
    let lane = laneEndTimes.findIndex((end) => end <= item.startMonths + EPS);
    if (lane === -1) {
      lane = laneEndTimes.length;
      laneEndTimes.push(item.endMonths);
    } else {
      laneEndTimes[lane] = item.endMonths;
    }
    laneByIndex[index] = lane;
  }

  return items.map((item, index) => ({ ...item, lane: laneByIndex[index] }));
}

export interface CategorySchedule {
  laneCount: number;
  graded: (ScheduledProject & { lane: number })[];
  tail: (TimelineBar & { lane: number })[];
  pendingIds: Set<string>;
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

  const scheduled = simulateGradedSchedule(gradedInput, totalPeople);
  const gradedEnd = scheduled.reduce((max, s) => Math.max(max, s.endMonths), 0);
  const graded = assignLanes(scheduled);
  const gradedLaneCount = graded.reduce((max, g) => Math.max(max, g.lane + 1), 1);

  const capacityPerMonth = categoryCapacityPerMonth(totalPeople);
  const tail = buildCategoryBars(tailProjects, capacityPerMonth).map((bar) => ({
    ...bar,
    startMonths: bar.startMonths + gradedEnd,
    endMonths: bar.endMonths + gradedEnd,
    lane: gradedLaneCount,
  }));

  const pendingIds = new Set(
    tailProjects.filter((p) => assignments[p.id] != null).map((p) => p.id),
  );

  return {
    laneCount: gradedLaneCount + (tail.length > 0 ? 1 : 0),
    graded,
    tail,
    pendingIds,
  };
}
