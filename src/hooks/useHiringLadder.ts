/**
 * Drives the hire-plus-ceilings ladder (tryb 2) from the Symulacje screen.
 *
 * Same slice-per-macrotask contract as useHiringPlan, and for the same
 * reason: the search is hundreds of full re-simulations, and one synchronous
 * burst freezes the tab before the spinner paints. Nothing is written until
 * the human picks a rung; picking one creates a new variant carrying both
 * the hires and the rung's ceiling overrides.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CAPABILITY_ORDER } from "../lib/estimation";
import {
  createLadder,
  ladderResult,
  stepLadder,
  type LadderResult,
} from "../lib/hirePlusCeilings";
import type { HiringPlanInput } from "../lib/hiringPlanner";
import type { CapabilityVector } from "../types";

export type HiringLadderStatus = "idle" | "running" | "ready";

export interface HiringLadderApi {
  status: HiringLadderStatus;
  result: LadderResult | null;
  /** Rungs finished so far, for the progress line while it runs. */
  solved: number;
  simulations: number;
  /** The data changed since the search ran — rerun before applying. */
  stale: boolean;
  run: () => void;
  cancel: () => void;
  reset: () => void;
}

function fteKey(fte: CapabilityVector): string {
  return CAPABILITY_ORDER.map((capability) => fte[capability]).join("|");
}

export function useHiringLadder(
  baselineFte: CapabilityVector,
  input: HiringPlanInput,
): HiringLadderApi {
  const [status, setStatus] = useState<HiringLadderStatus>("idle");
  const [result, setResult] = useState<LadderResult | null>(null);
  const [solved, setSolved] = useState(0);
  const [simulations, setSimulations] = useState(0);

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
    const state = createLadder(baselineFte, input);

    // Each macrotask runs steps until ~30 ms of simulation work has
    // accumulated, and progress is published at most a few times a second —
    // a progress write re-renders the whole Symulacje screen, which costs
    // more than a search-fidelity simulation does. The yield between slices
    // goes through a MessageChannel rather than setTimeout: it hands the
    // frame back just the same, but a backgrounded tab clamps timer chains
    // to one per second (and later one per minute), which turned a
    // seconds-long search into minutes the moment the user switched tabs.
    let lastProgressAt = 0;
    const channel = new MessageChannel();
    const tick = () => {
      if (runId.current !== id) return;
      const sliceStart = performance.now();
      let done = stepLadder(state);
      while (!done && performance.now() - sliceStart < 30) done = stepLadder(state);
      if (done) {
        setSolved(state.rungs.length);
        setSimulations(state.simulations);
        setResult(ladderResult(state));
        setStatus("ready");
        return;
      }
      const now = performance.now();
      if (now - lastProgressAt >= 500) {
        lastProgressAt = now;
        setSolved(state.rungs.length);
        setSimulations(state.simulations);
      }
      channel.port2.postMessage(null);
    };
    channel.port1.onmessage = tick;
    channel.port2.postMessage(null);
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
