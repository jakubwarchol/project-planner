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
  Team,
} from "../types";

export interface PlannerSnapshot {
  /** In display order — the one global backlog order every pool schedules against. */
  projects: Project[];
  teams: Team[];
  people: Person[];
  variants: TeamVariant[];
  /** projectId -> capability -> cell. Dense: every project/capability pair present. */
  cells: Record<string, Record<Capability, CapabilityCell>>;
  settings: EstimationSettings;
  /** Real, named staffing — who is actually on what, and when. Obsada's own
   *  data, never read by the capability-pool scheduler. */
  assignments: StaffingAssignment[];
  /** Unlike assignments, leaves do reach the scheduler: `lib/leaves.ts` folds
   *  them into per-month pool reductions, so absences extend the plan. */
  leaves: Leave[];
}

// Everything the UI needs from storage. The only implementation is
// `httpRepo`, which talks to the API server in `server/` — that server owns
// the SQLite file and runs every statement. This interface is the contract
// between the two, so a change here means a change to both sides.
export interface PlannerRepository {
  loadSnapshot(): Promise<PlannerSnapshot>;

  setProjectOrder(orderedIds: string[]): Promise<void>;
  resetProjectOrder(): Promise<void>;

  createProject(project: Project): Promise<void>;
  updateProject(id: string, fields: Omit<Project, "id">): Promise<void>;
  deleteProject(id: string): Promise<void>;
  setBlockedBy(id: string, blockedById: string | null): Promise<void>;
  setIncludeInPlan(id: string, includeInPlan: boolean): Promise<void>;

  createVariant(variant: TeamVariant): Promise<void>;
  renameVariant(id: string, label: string): Promise<void>;
  setVariantFte(id: string, capability: Capability, fte: number): Promise<void>;
  /** Overwrite every capability of a variant from the live roster. */
  resetVariantFromRoster(id: string): Promise<void>;
  deleteVariant(id: string): Promise<void>;

  createPerson(person: Person): Promise<void>;
  updatePerson(id: string, fields: Omit<Person, "id">): Promise<void>;
  deletePerson(id: string): Promise<void>;
  /** One capability's share of a person. fte 0 takes them off it entirely. */
  setPersonAllocation(id: string, capability: Capability, fte: number): Promise<void>;

  createAssignment(assignment: StaffingAssignment): Promise<void>;
  updateAssignment(id: string, fields: Omit<StaffingAssignment, "id">): Promise<void>;
  deleteAssignment(id: string): Promise<void>;

  createLeave(leave: Leave): Promise<void>;
  updateLeave(id: string, fields: Omit<Leave, "id">): Promise<void>;
  deleteLeave(id: string): Promise<void>;

  /** Both columns in one write; the grid always knows both values. */
  setProjectCell(projectId: string, capability: Capability, cell: CapabilityCell): Promise<void>;
  /** Whole row, one transaction — used by paste. */
  setProjectRow(projectId: string, row: Record<Capability, CapabilityCell>): Promise<void>;

  /** Everything but the per-size weights. */
  updateEstimationSettings(fields: Omit<EstimationSettings, "estimateValues">): Promise<void>;
  setEstimateWeight(estimate: Estimate, weight: number): Promise<void>;

  /** Raw .sqlite bytes. Unimplemented over HTTP — the server owns the file, so
   *  a backup is a copy of `data/planner.sqlite`, not a download. Consumers
   *  must treat this as optional; `PlannerProvider` exposes null when absent. */
  exportDatabase?(): Promise<Uint8Array>;
}
