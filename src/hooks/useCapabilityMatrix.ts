import { useCallback } from "react";
import { CAPABILITY_ORDER } from "../lib/estimation";
import { usePlanner } from "../state/plannerContext";
import type { Capability, CapabilityCell } from "../types";

export interface CapabilityMatrixApi {
  cells: Record<string, Record<Capability, CapabilityCell>>;
  setCell: (projectId: string, capability: Capability, patch: Partial<CapabilityCell>) => void;
  rowSum: (projectId: string) => number;
}

export function useCapabilityMatrix(): CapabilityMatrixApi {
  const { cells, setProjectCell } = usePlanner();

  // Assigning days to a cell that had none, while its ceiling is still 0,
  // defaults that ceiling to 1.0 — a demanded capability with no ceiling
  // cannot be crewed at all, and the scheduler would condemn the whole
  // project rather than let it sit there waiting to be discovered.
  const setCell = useCallback(
    (projectId: string, capability: Capability, patch: Partial<CapabilityCell>) => {
      const current = cells[projectId]?.[capability] ?? { days: 0, maxFte: 0 };
      const next = { ...current, ...patch };
      if (patch.days != null && current.days <= 0 && next.days > 0 && current.maxFte <= 0) {
        next.maxFte = 1;
      }
      setProjectCell(projectId, capability, next);
    },
    [cells, setProjectCell],
  );

  const rowSum = useCallback(
    (projectId: string) => {
      const row = cells[projectId];
      if (!row) return 0;
      return CAPABILITY_ORDER.reduce((sum, capability) => sum + (row[capability]?.days ?? 0), 0);
    },
    [cells],
  );

  return { cells, setCell, rowSum };
}
