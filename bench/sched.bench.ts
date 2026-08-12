import {
  derivePoolsFromPeople,
  effectiveDaysByCapability,
  isIncludedInPlan,
} from "../src/lib/estimation";
import { simulateCapabilitySchedule } from "../src/lib/scheduling";

async function main() {
  const snap = await (await fetch("http://localhost:5173/api/snapshot")).json();
  const planned = snap.projects.filter(isIncludedInPlan);
  const input = {
    projects: planned,
    cells: snap.cells,
    pools: derivePoolsFromPeople(snap.people),
    effectiveDaysPerMonth: effectiveDaysByCapability(snap.people, snap.settings),
    minStaffingFraction: snap.settings.minStaffingFraction,
    earliestStart: {},
  };
  const warm = simulateCapabilitySchedule(input);
  const runs = 8;
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) simulateCapabilitySchedule(input);
  const per = (performance.now() - t0) / runs;
  console.log(`projects in plan: ${planned.length}`);
  console.log(`simulateCapabilitySchedule: ${per.toFixed(0)} ms per call  (was 622-668 ms)`);
  console.log(`horizonMonths: ${warm.horizonMonths.toFixed(2)}`);
}
main();
