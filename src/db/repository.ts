import type { TeamVariant } from "../lib/estimation";
import type { Project } from "../types";

export interface PlannerSnapshot {
  /** In display order. */
  projects: Project[];
  variants: TeamVariant[];
  /** projectId -> people graded onto it. */
  assignments: Record<string, number>;
}

// Everything the UI needs from storage. The local implementation runs SQL
// against sql.js; the server one will run the same statements behind HTTP, so
// swapping them is a one-line change in `createRepository`.
export interface PlannerRepository {
  loadSnapshot(): Promise<PlannerSnapshot>;

  setProjectOrder(orderedIds: string[]): Promise<void>;
  resetProjectOrder(): Promise<void>;

  createVariant(variant: TeamVariant): Promise<void>;
  renameVariant(id: string, label: string): Promise<void>;
  setVariantPeople(id: string, category: string, people: number): Promise<void>;
  deleteVariant(id: string): Promise<void>;

  setAssignment(projectId: string, people: number): Promise<void>;
  clearAssignment(projectId: string): Promise<void>;

  /** Raw .sqlite bytes. Local only — the server owns its own file. */
  exportDatabase?(): Promise<Uint8Array>;
}
