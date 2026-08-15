/**
 * Benchmarks the schedule simulation and the Symulacje hiring ladder on the
 * real backlog, loaded straight from data/planner.sqlite — the same input
 * TimelineView builds, no dev server needed.
 *
 * Usage:
 *   npx tsx bench/profile-ladder.ts --sim      one exact simulation, timed
 *   npx tsx bench/profile-ladder.ts --ladder   the full hire-plus-ceilings ladder
 */
import { getDatabase } from "../server/db";
import { loadSnapshot } from "../server/repo";
import {
  effectiveDaysByCapability,
  isIncludedInPlan,
  CAPABILITY_ORDER,
} from "../src/lib/estimation";
import { leaveFteByMonth } from "../src/lib/leaves";
import { earliestStartOffsets } from "../src/hooks/useCapabilitySchedule";
import { monthKeyOf, monthsFrom, parseMonthKey } from "../src/lib/calendar";
import { applyCeilingOverrides } from "../src/lib/planRules";
import { simulateCapabilitySchedule } from "../src/lib/scheduling";
import { runLadder } from "../src/lib/hirePlusCeilings";
import type { HiringPlanInput } from "../src/lib/hiringPlanner";

const db = getDatabase();
const snap = loadSnapshot(db);
const planned = snap.projects.filter(isIncludedInPlan);
const roster = snap.variants.find((v) => v.isRosterDerived) ?? snap.variants[0];
const cells = applyCeilingOverrides(snap.cells, roster.ceilings);
const edpm = effectiveDaysByCapability(snap.people, snap.settings);
const earliestStart = earliestStartOffsets(planned);
const leaveDips = leaveFteByMonth(snap.people, snap.leaves ?? []);
const nowMonth = parseMonthKey(monthKeyOf(new Date()))!;
const deadlineMonths: Record<string, number> = {};
for (const p of planned) {
  const m = monthsFrom(nowMonth, p.deadlineDate);
  if (m != null) deadlineMonths[p.id] = m;
}

const input: HiringPlanInput = {
  projects: planned,
  cells,
  effectiveDaysPerMonth: edpm,
  minStaffingFraction: snap.settings.minStaffingFraction,
  minCrewFte: snap.settings.minCrewFte,
  earliestStart,
  leaveFteByMonth: leaveDips,
  deadlineMonths,
  caps: {},
};

console.log(`projects in plan: ${planned.length}`);
console.log(`roster: ${CAPABILITY_ORDER.map((c) => `${c}=${roster.fte[c]}`).join(" ")}`);

const mode = process.argv[2] ?? "--sim";

if (mode === "--sim") {
  const { deadlineMonths: _d, caps: _c, ...simInput } = input;
  const withPools = { ...simInput, pools: roster.fte };
  const warm = simulateCapabilitySchedule(withPools);
  const runs = 8;
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) simulateCapabilitySchedule(withPools);
  const per = (performance.now() - t0) / runs;
  console.log(`simulateCapabilitySchedule: ${per.toFixed(1)} ms per call`);
  console.log(`horizonMonths: ${warm.horizonMonths.toFixed(3)}`);
} else if (mode === "--ladder") {
  const t0 = performance.now();
  const result = runLadder(roster.fte, input);
  const total = performance.now() - t0;
  console.log(
    `runLadder: ${(total / 1000).toFixed(1)} s total, ${result.simulations} simulations, ` +
      `${(total / result.simulations).toFixed(1)} ms/sim`,
  );
  console.log(`base horizon: ${result.base.horizonMonths.toFixed(2)}m`);
  for (const r of result.rungs) {
    const team =
      Object.entries(r.byCapability)
        .map(([c, n]) => `${c}+${n}`)
        .join(" ") || "(today)";
    console.log(
      `  rung +${r.hires} [${team}] horizon ${r.horizonMonths.toFixed(2)}m, ` +
        `${r.ceilingMoves.length} raises${r.raisesTruncated ? " (truncated)" : ""}`,
    );
  }
}
