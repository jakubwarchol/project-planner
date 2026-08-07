import { useCallback } from "react";
import { CATEGORY_ORDER, type TeamVariant } from "../lib/estimation";
import { usePlanner } from "../state/plannerContext";

export const MAX_PEOPLE_PER_CATEGORY = 99;

export function clampPeople(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), MAX_PEOPLE_PER_CATEGORY);
}

function newVariantId(): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return `variant-${suffix}`;
}

// "Variant 4" for a list that already holds 1..3 — the lowest number that
// isn't taken, so labels stay tidy after deletes.
function nextVariantLabel(variants: TeamVariant[]): string {
  const taken = new Set(variants.map((v) => v.label));
  for (let n = 1; n <= variants.length + 1; n += 1) {
    const label = `Variant ${n}`;
    if (!taken.has(label)) return label;
  }
  return `Variant ${variants.length + 1}`;
}

export interface TeamVariantsApi {
  variants: TeamVariant[];
  /** Copies `seed` (or starts empty) into a new variant and returns its id. */
  createVariant: (seed?: TeamVariant) => string;
  renameVariant: (id: string, label: string) => void;
  setVariantPeople: (id: string, category: string, people: number) => void;
  /** No-op when it would empty the list — there is always at least one variant. */
  deleteVariant: (id: string) => void;
}

export function useTeamVariants(): TeamVariantsApi {
  const planner = usePlanner();
  const { variants, addVariant, renameVariant, setVariantPeople, deleteVariant } = planner;

  const createVariant = useCallback(
    (seed?: TeamVariant) => {
      const people: Record<string, number> = {};
      for (const category of CATEGORY_ORDER) {
        people[category] = clampPeople(Number(seed?.people[category] ?? 0));
      }
      const variant: TeamVariant = {
        id: newVariantId(),
        label: nextVariantLabel(variants),
        people,
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

  const setPeople = useCallback(
    (id: string, category: string, people: number) =>
      setVariantPeople(id, category, clampPeople(people)),
    [setVariantPeople],
  );

  return {
    variants,
    createVariant,
    renameVariant,
    setVariantPeople: setPeople,
    deleteVariant: guardedDelete,
  };
}
