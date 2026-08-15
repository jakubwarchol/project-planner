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
  /** The matrix changed since the search ran — each move's `from`/deltas
   *  describe a grid that no longer exists, so applying must wait for a rerun. */
  stale: boolean;
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

  // The cells object the search ran against. The grid stays editable behind
  // the drawer, and the reducer replaces this object on every cell edit — so
  // identity is exactly "has anything changed since the numbers were priced".
  const cellsAtSearch = useRef<Cells | null>(null);

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

    cellsAtSearch.current = cells;
    const state = createSearch(cells, input);

    // Publishing progress re-renders the whole screen, which costs more than
    // a search round does — so it is throttled, and never blocks a round.
    // The yield between rounds is a MessageChannel macrotask, not rAF or
    // setTimeout: rAF stops entirely in a background tab, and timer chains
    // there are clamped to one per second — either would leave a proposal
    // crawling half-finished the moment you switch away.
    let lastProgressAt = 0;
    const channel = new MessageChannel();
    const tick = () => {
      if (runId.current !== id) return;
      const done = stepSearch(state);
      const now = performance.now();
      if (done || now - lastProgressAt >= 500) {
        lastProgressAt = now;
        setFound(state.moves.length);
      }
      if (done) {
        const finished = searchResult(state);
        setResult(finished);
        setAccepted(new Set(finished.moves.map((_, i) => i)));
        setPreviewHorizon(finished.horizonAfter);
        setStatus("ready");
        return;
      }
      channel.port2.postMessage(null);
    };
    channel.port1.onmessage = tick;
    channel.port2.postMessage(null);
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

  // The search can raise the same cell twice (1.0→1.5, then 1.5→2.0), and the
  // later move's `to` assumes the earlier one happened. Checking a move pulls
  // its prerequisites in; unchecking one drops everything built on it.
  const toggle = useCallback(
    (index: number) => {
      setAccepted((current) => {
        const moves = result?.moves ?? [];
        const target = moves[index];
        if (!target) return current;
        const sameCell = (m: CeilingMove) =>
          m.projectId === target.projectId && m.capability === target.capability;
        const next = new Set(current);
        if (next.has(index)) {
          next.delete(index);
          for (let i = index + 1; i < moves.length; i++) {
            if (sameCell(moves[i])) next.delete(i);
          }
        } else {
          next.add(index);
          for (let i = 0; i < index; i++) {
            if (sameCell(moves[i])) next.add(i);
          }
        }
        reprice(next);
        return next;
      });
    },
    [reprice, result],
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
    stale: status === "ready" && cellsAtSearch.current !== null && cells !== cellsAtSearch.current,
    run,
    cancel,
    toggle,
    setAll,
    acceptedMoves,
    reset,
  };
}
