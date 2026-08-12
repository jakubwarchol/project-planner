import { createContext, useContext } from "react";
import type { PlannerSnapshot } from "../db";
import type { TeamVariant } from "../lib/estimation";
import type {
  Capability,
  CapabilityCell,
  Estimate,
  EstimationSettings,
  Leave,
  Person,
  Project,
  StaffingAssignment,
} from "../types";

export interface PlannerContextValue extends PlannerSnapshot {
  setProjects: (projects: Project[]) => void;
  resetProjectOrder: () => void;
  addProject: (project: Project) => void;
  updateProject: (id: string, fields: Omit<Project, "id">) => void;
  removeProject: (id: string) => void;
  setBlockedBy: (id: string, blockedById: string | null) => void;
  setIncludeInPlan: (id: string, includeInPlan: boolean) => void;

  addVariant: (variant: TeamVariant) => void;
  renameVariant: (id: string, label: string) => void;
  setVariantFte: (id: string, capability: Capability, fte: number) => void;
  resetVariantFromRoster: (id: string) => void;
  deleteVariant: (id: string) => void;

  addPerson: (person: Person) => void;
  updatePerson: (id: string, fields: Omit<Person, "id">) => void;
  removePerson: (id: string) => void;
  setPersonAllocation: (id: string, capability: Capability, fte: number) => void;

  addAssignment: (assignment: StaffingAssignment) => void;
  updateAssignment: (id: string, fields: Omit<StaffingAssignment, "id">) => void;
  removeAssignment: (id: string) => void;

  addLeave: (leave: Leave) => void;
  updateLeave: (id: string, fields: Omit<Leave, "id">) => void;
  removeLeave: (id: string) => void;

  setProjectCell: (projectId: string, capability: Capability, cell: CapabilityCell) => void;
  setProjectRow: (projectId: string, row: Record<Capability, CapabilityCell>) => void;

  updateEstimationSettings: (fields: Omit<EstimationSettings, "estimateValues">) => void;
  setEstimateWeight: (estimate: Estimate, weight: number) => void;

  exportDatabase: (() => Promise<Uint8Array>) | null;
}

export const PlannerContext = createContext<PlannerContextValue | null>(null);

export function usePlanner(): PlannerContextValue {
  const value = useContext(PlannerContext);
  if (!value) throw new Error("usePlanner must be used inside <PlannerProvider>");
  return value;
}
