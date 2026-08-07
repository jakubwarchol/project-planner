import { createContext, useContext } from "react";
import type { PlannerSnapshot } from "../db";
import type { TeamVariant } from "../lib/estimation";
import type { Project } from "../types";

export interface PlannerContextValue extends PlannerSnapshot {
  setProjects: (projects: Project[]) => void;
  resetProjectOrder: () => void;
  addVariant: (variant: TeamVariant) => void;
  renameVariant: (id: string, label: string) => void;
  setVariantPeople: (id: string, category: string, people: number) => void;
  deleteVariant: (id: string) => void;
  setAssignment: (projectId: string, people: number) => void;
  clearAssignment: (projectId: string) => void;
  exportDatabase: (() => Promise<Uint8Array>) | null;
}

export const PlannerContext = createContext<PlannerContextValue | null>(null);

export function usePlanner(): PlannerContextValue {
  const value = useContext(PlannerContext);
  if (!value) throw new Error("usePlanner must be used inside <PlannerProvider>");
  return value;
}
