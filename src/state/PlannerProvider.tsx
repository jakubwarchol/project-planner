import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { ReactNode } from "react";
import { getRepository } from "../db";
import { emptyCapabilityCells, type TeamVariant } from "../lib/estimation";
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
import { PlannerContext, type PlannerContextValue } from "./plannerContext";
import { plannerReducer } from "./plannerReducer";

// Writes are optimistic: state moves first so the UI stays instant, and the
// repository call follows. Once that call is a network round trip a failure
// needs surfacing to the user — for now it lands in the console.
function report(action: string) {
  return (error: unknown) => console.error(`[planner] ${action} failed`, error);
}

export function PlannerProvider({ children }: { children: ReactNode }) {
  const repo = useMemo(() => getRepository(), []);
  const [snapshot, dispatch] = useReducer(plannerReducer, null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    repo
      .loadSnapshot()
      .then((data) => {
        if (!cancelled) dispatch({ type: "snapshot", snapshot: data });
      })
      .catch((err) => {
        console.error("[planner] could not open the database", err);
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const setProjects = useCallback(
    (projects: Project[]) => {
      dispatch({ type: "setProjects", projects });
      repo.setProjectOrder(projects.map((p) => p.id)).catch(report("reorder"));
    },
    [repo],
  );

  const resetProjectOrder = useCallback(() => {
    repo
      .resetProjectOrder()
      .then(() => repo.loadSnapshot())
      .then((data) => dispatch({ type: "snapshot", snapshot: data }))
      .catch(report("reset order"));
  }, [repo]);

  const addProject = useCallback(
    (project: Project) => {
      dispatch({ type: "addProject", project, cells: emptyCapabilityCells() });
      repo.createProject(project).catch(report("add project"));
    },
    [repo],
  );

  const updateProject = useCallback(
    (id: string, fields: Omit<Project, "id">) => {
      dispatch({ type: "updateProject", id, fields });
      repo.updateProject(id, fields).catch(report("update project"));
    },
    [repo],
  );

  const removeProject = useCallback(
    (id: string) => {
      dispatch({ type: "removeProject", id });
      repo.deleteProject(id).catch(report("delete project"));
    },
    [repo],
  );

  const setBlockedBy = useCallback(
    (id: string, blockedById: string | null) => {
      dispatch({ type: "setBlockedBy", id, blockedById });
      repo.setBlockedBy(id, blockedById).catch(report("set blocked by"));
    },
    [repo],
  );

  const setIncludeInPlan = useCallback(
    (id: string, includeInPlan: boolean) => {
      dispatch({ type: "setIncludeInPlan", id, includeInPlan });
      repo.setIncludeInPlan(id, includeInPlan).catch(report("set include in plan"));
    },
    [repo],
  );

  const addVariant = useCallback(
    (variant: TeamVariant) => {
      dispatch({ type: "addVariant", variant });
      repo.createVariant(variant).catch(report("create variant"));
    },
    [repo],
  );

  const renameVariant = useCallback(
    (id: string, label: string) => {
      dispatch({ type: "renameVariant", id, label });
      repo.renameVariant(id, label).catch(report("rename variant"));
    },
    [repo],
  );

  const setVariantFte = useCallback(
    (id: string, capability: Capability, fte: number) => {
      dispatch({ type: "setVariantFte", id, capability, fte });
      repo.setVariantFte(id, capability, fte).catch(report("set variant fte"));
    },
    [repo],
  );

  const resetVariantFromRoster = useCallback(
    (id: string) => {
      dispatch({ type: "resetVariantFromRoster", id });
      repo.resetVariantFromRoster(id).catch(report("reset variant from roster"));
    },
    [repo],
  );

  const deleteVariant = useCallback(
    (id: string) => {
      dispatch({ type: "deleteVariant", id });
      repo.deleteVariant(id).catch(report("delete variant"));
    },
    [repo],
  );

  const addPerson = useCallback(
    (person: Person) => {
      dispatch({ type: "addPerson", person });
      repo.createPerson(person).catch(report("add person"));
    },
    [repo],
  );

  const updatePerson = useCallback(
    (id: string, fields: Omit<Person, "id">) => {
      dispatch({ type: "updatePerson", id, fields });
      repo.updatePerson(id, fields).catch(report("update person"));
    },
    [repo],
  );

  const removePerson = useCallback(
    (id: string) => {
      dispatch({ type: "removePerson", id });
      repo.deletePerson(id).catch(report("remove person"));
    },
    [repo],
  );

  const setPersonAllocation = useCallback(
    (id: string, capability: Capability, fte: number) => {
      dispatch({ type: "setPersonAllocation", id, capability, fte });
      repo.setPersonAllocation(id, capability, fte).catch(report("set person allocation"));
    },
    [repo],
  );

  const addAssignment = useCallback(
    (assignment: StaffingAssignment) => {
      dispatch({ type: "addAssignment", assignment });
      repo.createAssignment(assignment).catch(report("add assignment"));
    },
    [repo],
  );

  const updateAssignment = useCallback(
    (id: string, fields: Omit<StaffingAssignment, "id">) => {
      dispatch({ type: "updateAssignment", id, fields });
      repo.updateAssignment(id, fields).catch(report("update assignment"));
    },
    [repo],
  );

  const removeAssignment = useCallback(
    (id: string) => {
      dispatch({ type: "removeAssignment", id });
      repo.deleteAssignment(id).catch(report("remove assignment"));
    },
    [repo],
  );

  const addLeave = useCallback(
    (leave: Leave) => {
      dispatch({ type: "addLeave", leave });
      repo.createLeave(leave).catch(report("add leave"));
    },
    [repo],
  );

  const updateLeave = useCallback(
    (id: string, fields: Omit<Leave, "id">) => {
      dispatch({ type: "updateLeave", id, fields });
      repo.updateLeave(id, fields).catch(report("update leave"));
    },
    [repo],
  );

  const removeLeave = useCallback(
    (id: string) => {
      dispatch({ type: "removeLeave", id });
      repo.deleteLeave(id).catch(report("remove leave"));
    },
    [repo],
  );

  const setProjectCell = useCallback(
    (projectId: string, capability: Capability, cell: CapabilityCell) => {
      dispatch({ type: "setProjectCell", projectId, capability, cell });
      repo.setProjectCell(projectId, capability, cell).catch(report("set project cell"));
    },
    [repo],
  );

  const setProjectRow = useCallback(
    (projectId: string, row: Record<Capability, CapabilityCell>) => {
      dispatch({ type: "setProjectRow", projectId, row });
      repo.setProjectRow(projectId, row).catch(report("set project row"));
    },
    [repo],
  );

  const updateEstimationSettings = useCallback(
    (fields: Omit<EstimationSettings, "estimateValues">) => {
      dispatch({ type: "updateEstimationSettings", fields });
      repo.updateEstimationSettings(fields).catch(report("update estimation settings"));
    },
    [repo],
  );

  const setEstimateWeight = useCallback(
    (estimate: Estimate, weight: number) => {
      dispatch({ type: "setEstimateWeight", estimate, weight });
      repo.setEstimateWeight(estimate, weight).catch(report("set estimate weight"));
    },
    [repo],
  );

  const value = useMemo<PlannerContextValue | null>(() => {
    if (!snapshot) return null;
    return {
      ...snapshot,
      setProjects,
      resetProjectOrder,
      addProject,
      updateProject,
      removeProject,
      setBlockedBy,
      setIncludeInPlan,
      addVariant,
      renameVariant,
      setVariantFte,
      resetVariantFromRoster,
      deleteVariant,
      addPerson,
      updatePerson,
      removePerson,
      setPersonAllocation,
      addAssignment,
      updateAssignment,
      removeAssignment,
      addLeave,
      updateLeave,
      removeLeave,
      setProjectCell,
      setProjectRow,
      updateEstimationSettings,
      setEstimateWeight,
      exportDatabase: repo.exportDatabase ? () => repo.exportDatabase!() : null,
    };
  }, [
    snapshot,
    repo,
    setProjects,
    resetProjectOrder,
    addProject,
    updateProject,
    removeProject,
    setBlockedBy,
    setIncludeInPlan,
    addVariant,
    renameVariant,
    setVariantFte,
    resetVariantFromRoster,
    deleteVariant,
    addPerson,
    updatePerson,
    removePerson,
    setPersonAllocation,
    addAssignment,
    updateAssignment,
    removeAssignment,
    addLeave,
    updateLeave,
    removeLeave,
    setProjectCell,
    setProjectRow,
    updateEstimationSettings,
    setEstimateWeight,
  ]);

  if (error) {
    return (
      <div className="db-splash">
        <p>Nie udało się otworzyć bazy danych planera.</p>
        <code>{error}</code>
      </div>
    );
  }

  // Holding children back until the snapshot is in means no component below
  // has to deal with a half-loaded store.
  if (!value) return <div className="db-splash">Wczytywanie…</div>;

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}
