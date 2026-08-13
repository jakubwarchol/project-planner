/**
 * Drives the pool optimizer from the Symulacje screen.
 *
 * Same contract as useCeilingProposal: the search is hundreds of full
 * re-simulations, so it runs one budgeted slice at a time with the frame
 * handed back in between — a single synchronous burst freezes the tab hard
 * enough that the spinner announcing the wait never gets to paint. Nothing is
 * written until the human applies, and applying creates a new variant rather
 * than touching anything that exists.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CAPABILITY_ORDER } from "../lib/estimation";
import {
  composeVector,
  createSearch,
  projectDeltasOf,
  scoreOf,
  searchResult,
  stepSearch,
  type PlanScore,
  type PoolMove,
  type PoolOptimizerResult,
  type PoolSearchInput,
  type ProjectEndDelta,
} from "../lib/poolOptimizer";
import { simulateCapabilitySchedule } from "../lib/scheduling";
import type { CapabilityVector } from "../types";

export type PoolProposalStatus = "idle" | "running" | "ready";

/** The plan exactly the ticked subset would produce — summary strip and
 *  who-loses list both read from here, so they always describe the same set. */
export interface PoolProposalPreview {
  score: PlanScore;
  pools: CapabilityVector;
  projectDeltas: ProjectEndDelta[];
}

export interface PoolProposalApi {
  status: PoolProposalStatus;
  result: PoolOptimizerResult | null;
  /** Moves found so far, for the progress line while it runs. */
  found: number;
  simulations: number;
  /** Which moves the human has kept, by index into `result.moves`. */
  accepted: Set<number>;
  preview: PoolProposalPreview | null;
  /** The data changed since the search ran — every figure describes a plan
   *  that no longer exists, so applying must wait for a rerun. */
  stale: boolean;
  run: () => void;
  cancel: () => void;
  toggle: (index: number) => void;
  setAll: (on: boolean) => void;
  acceptedMoves: () => PoolMove[];
  /** The vector "Zastosuj" writes — composed from the accepted subset and
   *  rounded at this one boundary, so the stored variant is the previewed one. */
  composedVector: () => CapabilityVector;
  reset: () => void;
}

/** Value-keyed, not identity-keyed: the roster-derived baseline's `fte` object
 *  can be recreated without changing, and staleness must not care. */
function fteKey(fte: CapabilityVector): string {
  return CAPABILITY_ORDER.map((capability) => fte[capability]).join("|");
}

/** The largest prefix-feasible subset of `next`: walking the moves in order,
 *  a ticked move whose donor cannot fund it — because the earlier move that
 *  credited that pool is unticked — is dropped. Pool moves chain through
 *  capacity rather than through cells, so feasibility is the prerequisite
 *  relation here. */
function feasibleSubset(
  moves: PoolMove[],
  next: ReadonlySet<number>,
  base: CapabilityVector,
): Set<number> {
  const running = { ...base };
  const kept = new Set<number>();
  moves.forEach((move, index) => {
    if (!next.has(index)) return;
    if (running[move.from] >= move.fte - 1e-9) {
      running[move.from] -= move.fte;
      running[move.to] += move.fte;
      kept.add(index);
    }
  });
  return kept;
}

export function usePoolProposal(
  baselineFte: CapabilityVector,
  input: PoolSearchInput,
): PoolProposalApi {
  const [status, setStatus] = useState<PoolProposalStatus>("idle");
  const [result, setResult] = useState<PoolOptimizerResult | null>(null);
  const [found, setFound] = useState(0);
  const [simulations, setSimulations] = useState(0);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<PoolProposalPreview | null>(null);

  // Bumped on cancel and on unmount so an in-flight loop knows to stop
  // scheduling more slices rather than finishing and writing to dead state.
  const runId = useRef(0);
  useEffect(() => () => { runId.current++; }, []);

  // What the search ran against. The input memo only changes when projects,
  // cells, people, leaves or settings genuinely change; the baseline is
  // value-keyed (see fteKey) so identity churn cannot fake a change.
  const inputAtSearch = useRef<PoolSearchInput | null>(null);
  const baselineAtSearch = useRef<CapabilityVector | null>(null);
  const fteKeyAtSearch = useRef<string | null>(null);

  const reset = useCallback(() => {
    runId.current++;
    setStatus("idle");
    setResult(null);
    setFound(0);
    setSimulations(0);
    setAccepted(new Set());
    setPreview(null);
  }, []);

  const run = useCallback(() => {
    const id = ++runId.current;
    setStatus("running");
    setResult(null);
    setFound(0);
    setSimulations(0);
    setAccepted(new Set());
    setPreview(null);

    inputAtSearch.current = input;
    baselineAtSearch.current = { ...baselineFte };
    fteKeyAtSearch.current = fteKey(baselineFte);
    const state = createSearch(baselineFte, input);

    const tick = () => {
      if (runId.current !== id) return;
      const done = stepSearch(state);
      setFound(state.moves.length);
      setSimulations(state.simulations);
      if (done) {
        const finished = searchResult(state);
        setResult(finished);
        setAccepted(new Set(finished.moves.map((_, i) => i)));
        setPreview({
          score: finished.scoreAfter,
          pools: finished.poolsAfter,
          projectDeltas: finished.projectDeltas,
        });
        setStatus("ready");
        return;
      }
      // A macrotask, not rAF: rAF is throttled in a background tab and would
      // leave a proposal half-finished the moment you switch away.
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  }, [baselineFte, input]);

  const cancel = useCallback(() => {
    runId.current++;
    setStatus("idle");
  }, []);

  // Re-price whatever is currently ticked. One simulation, so it can run
  // straight through on every toggle.
  const reprice = useCallback(
    (next: Set<number>) => {
      const searched = inputAtSearch.current;
      const base = baselineAtSearch.current;
      if (!result || !searched || !base) return;
      const pools = composeVector(base, result.moves, next);
      const { deadlineMonths, ...simInput } = searched;
      const schedule = simulateCapabilitySchedule({ ...simInput, pools });
      const endsBefore: Record<string, number> = {};
      for (const delta of result.projectDeltas) endsBefore[delta.projectId] = delta.before;
      setPreview({
        score: scoreOf(schedule, deadlineMonths),
        pools,
        projectDeltas: projectDeltasOf(schedule, endsBefore, deadlineMonths),
      });
    },
    [result],
  );

  const toggle = useCallback(
    (index: number) => {
      setAccepted((current) => {
        const moves = result?.moves ?? [];
        const base = baselineAtSearch.current;
        if (!moves[index] || !base) return current;
        const next = new Set(current);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
          // A move can be funded by an earlier one — pull the funders of its
          // donor pool back in until it stands, or leave it off if nothing can
          // make it stand.
          let kept = feasibleSubset(moves, next, base);
          for (let i = index - 1; i >= 0 && !kept.has(index); i--) {
            if (moves[i].to === moves[index].from && !next.has(i)) {
              next.add(i);
              kept = feasibleSubset(moves, next, base);
            }
          }
        }
        const settled = feasibleSubset(moves, next, base);
        reprice(settled);
        return settled;
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

  const composedVector = useCallback((): CapabilityVector => {
    const base = baselineAtSearch.current ?? baselineFte;
    const vector = composeVector(base, result?.moves ?? [], accepted);
    for (const capability of CAPABILITY_ORDER) {
      // Quarters are binary-exact but a legacy tenths baseline plus quarters is
      // not — round once, here, at the write boundary.
      vector[capability] = Math.max(0, Math.round(vector[capability] * 100) / 100);
    }
    return vector;
  }, [accepted, baselineFte, result]);

  return {
    status,
    result,
    found,
    simulations,
    accepted,
    preview,
    stale:
      status === "ready" &&
      (input !== inputAtSearch.current || fteKey(baselineFte) !== fteKeyAtSearch.current),
    run,
    cancel,
    toggle,
    setAll,
    acceptedMoves,
    composedVector,
    reset,
  };
}
