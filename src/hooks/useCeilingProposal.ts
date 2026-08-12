/**
 * Drives the ceiling autopilot from the Kompetencje screen.
 *
 * The search is a couple of hundred full re-simulations and takes seconds on a
 * real backlog, so it is run one round at a time with the frame handed back in
 * between. Running it in a single burst freezes the tab hard enough that the
 * spinner announcing the wait never gets to paint.
 *
 * Nothing is written until the human presses apply. The proposal is a list of
 * claims — "1.5 backends could usefully work on this" — and the machine has no
 * way to check any of them.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSearch,
  searchResult,
  stepSearch,
  type AutopilotInput,
  type AutopilotResult,
  type CeilingMove,
} from "../lib/autopilot";
import { simulateCapabilitySchedule } from "../lib/scheduling";
import type { Capability, CapabilityCell } from "../types";

type Cells = Record<string, Record<Capability, CapabilityCell>>;

export type ProposalStatus = "idle" | "running" | "ready";

export interface CeilingProposalApi {
  status: ProposalStatus;
  result: AutopilotResult | null;
  /** Moves found so far, for the progress line while it runs. */
  found: number;
  /** Which moves the human has kept, by index into `result.moves`. */
  accepted: Set<number>;
  /** Horizon if exactly the accepted moves were applied. */
  previewHorizon: number | null;
  run: () => void;
  cancel: () => void;
  toggle: (index: number) => void;
  setAll: (on: boolean) => void;
  /** The accepted moves, in order, ready to write. */
  acceptedMoves: () => CeilingMove[];
  reset: () => void;
}

export function useCeilingProposal(cells: Cells, input: AutopilotInput): CeilingProposalApi {
  const [status, setStatus] = useState<ProposalStatus>("idle");
  const [result, setResult] = useState<AutopilotResult | null>(null);
  const [found, setFound] = useState(0);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [previewHorizon, setPreviewHorizon] = useState<number | null>(null);

  // Bumped on cancel and on unmount so an in-flight loop knows to stop
  // scheduling more rounds rather than finishing and writing to dead state.
  const runId = useRef(0);
  useEffect(() => () => { runId.current++; }, []);

  const reset = useCallback(() => {
    runId.current++;
    setStatus("idle");
    setResult(null);
    setFound(0);
    setAccepted(new Set());
    setPreviewHorizon(null);
  }, []);

  const run = useCallback(() => {
    const id = ++runId.current;
    setStatus("running");
    setResult(null);
    setFound(0);
    setAccepted(new Set());
    setPreviewHorizon(null);

    const state = createSearch(cells, input);

    const tick = () => {
      if (runId.current !== id) return;
      const done = stepSearch(state);
      setFound(state.moves.length);
      if (done) {
        const finished = searchResult(state);
        setResult(finished);
        setAccepted(new Set(finished.moves.map((_, i) => i)));
        setPreviewHorizon(finished.horizonAfter);
        setStatus("ready");
        return;
      }
      // A macrotask, not rAF: rAF is throttled in a background tab and would
      // leave a proposal half-finished the moment you switch away.
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  }, [cells, input]);

  const cancel = useCallback(() => {
    runId.current++;
    setStatus("idle");
  }, []);

  // Re-price whatever is currently ticked. One simulation, so it can run
  // straight through on every toggle.
  const reprice = useCallback(
    (next: Set<number>) => {
      if (!result) return;
      const trial: Cells = {};
      for (const projectId of Object.keys(cells)) {
        const row = {} as Record<Capability, CapabilityCell>;
        for (const key of Object.keys(cells[projectId]) as Capability[]) {
          row[key] = { ...cells[projectId][key] };
        }
        trial[projectId] = row;
      }
      for (const [i, move] of result.moves.entries()) {
        if (!next.has(i)) continue;
        const cell = trial[move.projectId]?.[move.capability];
        if (cell) cell.maxFte = move.to;
      }
      const schedule = simulateCapabilitySchedule({ ...input, cells: trial });
      setPreviewHorizon(
        schedule.scheduled.some((p) => p.isImpossible) ? Infinity : schedule.horizonMonths,
      );
    },
    [cells, input, result],
  );

  const toggle = useCallback(
    (index: number) => {
      setAccepted((current) => {
        const next = new Set(current);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        reprice(next);
        return next;
      });
    },
    [reprice],
  );

  const setAll = useCallback(
    (on: boolean) => {
      const next = on ? new Set((result?.moves ?? []).map((_, i) => i)) : new Set<number>();
      setAccepted(next);
      reprice(next);
    },
    [result, reprice],
  );

  const acceptedMoves = useCallback(
    () => (result?.moves ?? []).filter((_, i) => accepted.has(i)),
    [result, accepted],
  );

  return {
    status,
    result,
    found,
    accepted,
    previewHorizon,
    run,
    cancel,
    toggle,
    setAll,
    acceptedMoves,
    reset,
  };
}
