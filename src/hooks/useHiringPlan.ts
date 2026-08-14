/**
 * Drives the hiring planner from the Symulacje screen.
 *
 * Same contract as useCeilingProposal and the pool proposal before it: the
 * search is a few hundred full re-simulations, so it runs one budgeted slice at
 * a time and hands the frame back in between — a single synchronous burst
 * freezes the tab hard enough that the spinner announcing the wait never gets
 * to paint. Nothing is written until the human picks a scenario, and picking
 * one creates a new variant rather than touching anything that exists.
 *
 * Unlike the pool proposal there is no accepted-subset machinery: the scenarios
 * are alternatives, not a shopping list. You take one, whole.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CAPABILITY_ORDER } from "../lib/estimation";
import {
  createPlan,
  planResult,
  stepPlan,
  type HiringPlanInput,
  type HiringPlanResult,
} from "../lib/hiringPlanner";
import type { CapabilityVector } from "../types";

export type HiringPlanStatus = "idle" | "running" | "ready";

export interface HiringPlanApi {
  status: HiringPlanStatus;
  result: HiringPlanResult | null;
  /** Hire counts solved so far, for the progress line while it runs. */
  solved: number;
  simulations: number;
  /** The data changed since the search ran, so every figure on screen
   *  describes a plan that no longer exists. Applying waits for a rerun. */
  stale: boolean;
  run: () => void;
  cancel: () => void;
  reset: () => void;
}

/** Value-keyed, not identity-keyed: the roster-derived baseline's `fte` object
 *  is recreated on every load without changing, and staleness must not care. */
function fteKey(fte: CapabilityVector): string {
  return CAPABILITY_ORDER.map((capability) => fte[capability]).join("|");
}

export function useHiringPlan(
  baselineFte: CapabilityVector,
  input: HiringPlanInput,
): HiringPlanApi {
  const [status, setStatus] = useState<HiringPlanStatus>("idle");
  const [result, setResult] = useState<HiringPlanResult | null>(null);
  const [solved, setSolved] = useState(0);
  const [simulations, setSimulations] = useState(0);

  // Bumped on cancel and on unmount so an in-flight loop stops scheduling more
  // slices rather than finishing and writing into dead state.
  const runId = useRef(0);
  useEffect(
    () => () => {
      runId.current++;
    },
    [],
  );

  const inputAtSearch = useRef<HiringPlanInput | null>(null);
  const fteKeyAtSearch = useRef<string | null>(null);

  const reset = useCallback(() => {
    runId.current++;
    setStatus("idle");
    setResult(null);
    setSolved(0);
    setSimulations(0);
  }, []);

  const run = useCallback(() => {
    const id = ++runId.current;
    setStatus("running");
    setResult(null);
    setSolved(0);
    setSimulations(0);

    inputAtSearch.current = input;
    fteKeyAtSearch.current = fteKey(baselineFte);
    const state = createPlan(baselineFte, input);

    const tick = () => {
      if (runId.current !== id) return;
      const done = stepPlan(state);
      setSolved(state.best.length);
      setSimulations(state.simulations);
      if (done) {
        setResult(planResult(state));
        setStatus("ready");
        return;
      }
      // A macrotask, not rAF: rAF is throttled in a background tab and would
      // leave the plan half-finished the moment you switch away.
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  }, [baselineFte, input]);

  const cancel = useCallback(() => {
    runId.current++;
    setStatus("idle");
  }, []);

  const stale =
    status === "ready" &&
    (inputAtSearch.current !== input || fteKeyAtSearch.current !== fteKey(baselineFte));

  return { status, result, solved, simulations, stale, run, cancel, reset };
}
