import type { PlannerSnapshot } from "../db";
import { derivePoolsFromPeople, type TeamVariant } from "../lib/estimation";
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

export type PlannerAction =
  | { type: "snapshot"; snapshot: PlannerSnapshot }
  | { type: "setProjects"; projects: Project[] }
  | { type: "addProject"; project: Project; cells: Record<Capability, CapabilityCell> }
  | { type: "updateProject"; id: string; fields: Omit<Project, "id"> }
  | { type: "removeProject"; id: string }
  | { type: "setBlockedBy"; id: string; blockedById: string | null }
  | { type: "setIncludeInPlan"; id: string; includeInPlan: boolean }
  | { type: "addVariant"; variant: TeamVariant }
  | { type: "renameVariant"; id: string; label: string }
  | { type: "setVariantFte"; id: string; capability: Capability; fte: number }
  | { type: "resetVariantFromRoster"; id: string }
  | { type: "deleteVariant"; id: string }
  | { type: "addPerson"; person: Person }
  | { type: "updatePerson"; id: string; fields: Omit<Person, "id"> }
  | { type: "removePerson"; id: string }
  | { type: "setPersonAllocation"; id: string; capability: Capability; fte: number }
  | { type: "addAssignment"; assignment: StaffingAssignment }
  | { type: "updateAssignment"; id: string; fields: Omit<StaffingAssignment, "id"> }
  | { type: "removeAssignment"; id: string }
  | { type: "addLeave"; leave: Leave }
  | { type: "updateLeave"; id: string; fields: Omit<Leave, "id"> }
  | { type: "removeLeave"; id: string }
  | { type: "setProjectCell"; projectId: string; capability: Capability; cell: CapabilityCell }
  | { type: "setProjectRow"; projectId: string; row: Record<Capability, CapabilityCell> }
  | { type: "updateEstimationSettings"; fields: Omit<EstimationSettings, "estimateValues"> }
  | { type: "setEstimateWeight"; estimate: Estimate; weight: number };

// Wariant 1 tracks the live roster rather than storing its own numbers, so
// editing a person moves it without a repository round trip.
function withDerivedVariants(snapshot: PlannerSnapshot): PlannerSnapshot {
  const derived = derivePoolsFromPeople(snapshot.people);
  const variants = snapshot.variants.map((v) => (v.isRosterDerived ? { ...v, fte: derived } : v));
  return { ...snapshot, variants };
}

function applyAction(state: PlannerSnapshot, action: PlannerAction): PlannerSnapshot {
  switch (action.type) {
    case "snapshot":
      return action.snapshot;

    case "setProjects":
      return { ...state, projects: action.projects };

    case "addProject":
      return {
        ...state,
        projects: [...state.projects, action.project],
        cells: { ...state.cells, [action.project.id]: action.cells },
      };

    // Merged onto the existing project, not substituted for it. The edit form
    // sends the seven columns it owns — exactly the set `updateProject`'s SQL
    // writes — and says nothing about `blockedBy` or `includeInPlan`. Replacing
    // the object wholesale dropped those two, so saving an edit silently pulled
    // an excluded project back into the plan and cleared its blocking link
    // until the next reload put the database's version back.
    case "updateProject":
      return {
        ...state,
        projects: state.projects.map((p) => (p.id === action.id ? { ...p, ...action.fields, id: action.id } : p)),
      };

    case "removeProject": {
      const projects = state.projects
        .filter((p) => p.id !== action.id)
        .map((p) => (p.blockedBy === action.id ? { ...p, blockedBy: undefined } : p));
      const cells = { ...state.cells };
      delete cells[action.id];
      return { ...state, projects, cells };
    }

    case "setBlockedBy":
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.id ? { ...p, blockedBy: action.blockedById ?? undefined } : p,
        ),
      };

    case "setIncludeInPlan":
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.id ? { ...p, includeInPlan: action.includeInPlan } : p,
        ),
      };

    case "addVariant":
      return { ...state, variants: [...state.variants, action.variant] };

    case "renameVariant":
      return {
        ...state,
        variants: state.variants.map((v) => (v.id === action.id ? { ...v, label: action.label } : v)),
      };

    case "setVariantFte":
      return {
        ...state,
        variants: state.variants.map((v) =>
          v.id === action.id
            ? { ...v, isRosterDerived: false, fte: { ...v.fte, [action.capability]: action.fte } }
            : v,
        ),
      };

    case "resetVariantFromRoster": {
      const derived = derivePoolsFromPeople(state.people);
      return {
        ...state,
        variants: state.variants.map((v) => (v.id === action.id ? { ...v, fte: { ...derived } } : v)),
      };
    }

    case "deleteVariant":
      return { ...state, variants: state.variants.filter((v) => v.id !== action.id) };

    case "addPerson":
      return { ...state, people: [...state.people, action.person] };

    case "updatePerson":
      return {
        ...state,
        people: state.people.map((p) => (p.id === action.id ? { id: action.id, ...action.fields } : p)),
      };

    case "removePerson":
      return { ...state, people: state.people.filter((p) => p.id !== action.id) };

    case "setPersonAllocation":
      return {
        ...state,
        people: state.people.map((p) => {
          if (p.id !== action.id) return p;
          // fte 0 removes the capability rather than storing a zero row, so
          // "works here but gives nothing" is never a representable state.
          const rest = p.allocations.filter((a) => a.capability !== action.capability);
          return {
            ...p,
            allocations:
              action.fte > 0
                ? [...rest, { capability: action.capability, fte: action.fte }].sort((a, b) =>
                    a.capability.localeCompare(b.capability),
                  )
                : rest,
          };
        }),
      };

    case "addAssignment":
      return { ...state, assignments: [...state.assignments, action.assignment] };

    case "updateAssignment":
      return {
        ...state,
        assignments: state.assignments.map((a) => (a.id === action.id ? { id: action.id, ...action.fields } : a)),
      };

    case "removeAssignment":
      return { ...state, assignments: state.assignments.filter((a) => a.id !== action.id) };

    case "addLeave":
      return { ...state, leaves: [...state.leaves, action.leave] };

    case "updateLeave":
      return {
        ...state,
        leaves: state.leaves.map((l) => (l.id === action.id ? { id: action.id, ...action.fields } : l)),
      };

    case "removeLeave":
      return { ...state, leaves: state.leaves.filter((l) => l.id !== action.id) };

    case "setProjectCell":
      return {
        ...state,
        cells: {
          ...state.cells,
          [action.projectId]: { ...state.cells[action.projectId], [action.capability]: action.cell },
        },
      };

    case "setProjectRow":
      return { ...state, cells: { ...state.cells, [action.projectId]: action.row } };

    case "updateEstimationSettings":
      return { ...state, settings: { ...state.settings, ...action.fields } };

    case "setEstimateWeight":
      return {
        ...state,
        settings: {
          ...state.settings,
          estimateValues: { ...state.settings.estimateValues, [action.estimate]: action.weight },
        },
      };
  }
}

export function plannerReducer(
  state: PlannerSnapshot | null,
  action: PlannerAction,
): PlannerSnapshot | null {
  if (action.type === "snapshot") return withDerivedVariants(action.snapshot);
  if (!state) return state;
  const next = applyAction(state, action);
  return next === state ? state : withDerivedVariants(next);
}
