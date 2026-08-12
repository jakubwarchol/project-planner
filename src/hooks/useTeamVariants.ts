import { useCallback } from "react";
import { CAPABILITY_ORDER, emptyCapabilityVector, type TeamVariant } from "../lib/estimation";
import { newId } from "../lib/id";
import { usePlanner } from "../state/plannerContext";
import type { Capability } from "../types";

export const MAX_FTE_PER_CAPABILITY = 99;

// One decimal place — fine-grained enough for a fraction of a person, coarse
// enough that the matrix stays readable.
export function clampFte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 10) / 10;
  return Math.min(Math.max(rounded, 0), MAX_FTE_PER_CAPABILITY);
}

// "Wariant 4" for a list that already holds 1..3 — the lowest number that
// isn't taken, so labels stay tidy after deletes.
function nextVariantLabel(variants: TeamVariant[]): string {
  const taken = new Set(variants.map((v) => v.label));
  for (let n = 1; n <= variants.length + 1; n += 1) {
    const label = `Wariant ${n}`;
    if (!taken.has(label)) return label;
  }
  return `Wariant ${variants.length + 1}`;
}

export interface TeamVariantsApi {
  variants: TeamVariant[];
  /** Copies `seed` (or starts empty) into a new variant and returns its id. */
  createVariant: (seed?: TeamVariant) => string;
  renameVariant: (id: string, label: string) => void;
  setVariantFte: (id: string, capability: Capability, fte: number) => void;
  /** Overwrites the variant's capabilities from the live roster. */
  copyFromRoster: (id: string) => void;
  /** No-op when it would empty the list — there is always at least one variant. */
  deleteVariant: (id: string) => void;
}

export function useTeamVariants(): TeamVariantsApi {
  const planner = usePlanner();
  const { variants, addVariant, renameVariant, setVariantFte, resetVariantFromRoster, deleteVariant } = planner;

  const createVariant = useCallback(
    (seed?: TeamVariant) => {
      const fte = emptyCapabilityVector();
      for (const capability of CAPABILITY_ORDER) fte[capability] = clampFte(Number(seed?.fte[capability] ?? 0));
      const variant: TeamVariant = {
        id: newId("variant"),
        label: nextVariantLabel(variants),
        fte,
        isRosterDerived: false,
      };
      addVariant(variant);
      return variant.id;
    },
    [variants, addVariant],
  );

  const guardedDelete = useCallback(
    (id: string) => {
      if (variants.length <= 1) return;
      deleteVariant(id);
    },
    [variants, deleteVariant],
  );

  const setFte = useCallback(
    (id: string, capability: Capability, fte: number) => setVariantFte(id, capability, clampFte(fte)),
    [setVariantFte],
  );

  return {
    variants,
    createVariant,
    renameVariant,
    setVariantFte: setFte,
    copyFromRoster: resetVariantFromRoster,
    deleteVariant: guardedDelete,
  };
}
