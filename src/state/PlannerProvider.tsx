import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getRepository } from "../db";
import type { PlannerSnapshot } from "../db";
import type { TeamVariant } from "../lib/estimation";
import type { Project } from "../types";
import { PlannerContext, type PlannerContextValue } from "./plannerContext";

// Writes are optimistic: state moves first so the UI stays instant, and the
// repository call follows. Once that call is a network round trip a failure
// needs surfacing to the user — for now it lands in the console.
function report(action: string) {
  return (error: unknown) => console.error(`[planner] ${action} failed`, error);
}

export function PlannerProvider({ children }: { children: ReactNode }) {
  const repo = useMemo(() => getRepository(), []);
  const [snapshot, setSnapshot] = useState<PlannerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    repo
      .loadSnapshot()
      .then((data) => {
        if (!cancelled) setSnapshot(data);
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
      setSnapshot((current) => (current ? { ...current, projects } : current));
      repo.setProjectOrder(projects.map((p) => p.id)).catch(report("reorder"));
    },
    [repo],
  );

  const resetProjectOrder = useCallback(() => {
    repo
      .resetProjectOrder()
      .then(() => repo.loadSnapshot())
      .then(setSnapshot)
      .catch(report("reset order"));
  }, [repo]);

  const addVariant = useCallback(
    (variant: TeamVariant) => {
      setSnapshot((current) =>
        current ? { ...current, variants: [...current.variants, variant] } : current,
      );
      repo.createVariant(variant).catch(report("create variant"));
    },
    [repo],
  );

  const renameVariant = useCallback(
    (id: string, label: string) => {
      setSnapshot((current) =>
        current
          ? { ...current, variants: current.variants.map((v) => (v.id === id ? { ...v, label } : v)) }
          : current,
      );
      repo.renameVariant(id, label).catch(report("rename variant"));
    },
    [repo],
  );

  const setVariantPeople = useCallback(
    (id: string, category: string, people: number) => {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              variants: current.variants.map((v) =>
                v.id === id ? { ...v, people: { ...v.people, [category]: people } } : v,
              ),
            }
          : current,
      );
      repo.setVariantPeople(id, category, people).catch(report("set variant people"));
    },
    [repo],
  );

  const deleteVariant = useCallback(
    (id: string) => {
      setSnapshot((current) =>
        current ? { ...current, variants: current.variants.filter((v) => v.id !== id) } : current,
      );
      repo.deleteVariant(id).catch(report("delete variant"));
    },
    [repo],
  );

  const setAssignment = useCallback(
    (projectId: string, people: number) => {
      setSnapshot((current) =>
        current
          ? { ...current, assignments: { ...current.assignments, [projectId]: people } }
          : current,
      );
      repo.setAssignment(projectId, people).catch(report("set assignment"));
    },
    [repo],
  );

  const clearAssignment = useCallback(
    (projectId: string) => {
      setSnapshot((current) => {
        if (!current) return current;
        const assignments = { ...current.assignments };
        delete assignments[projectId];
        return { ...current, assignments };
      });
      repo.clearAssignment(projectId).catch(report("clear assignment"));
    },
    [repo],
  );

  const value = useMemo<PlannerContextValue | null>(() => {
    if (!snapshot) return null;
    return {
      ...snapshot,
      setProjects,
      resetProjectOrder,
      addVariant,
      renameVariant,
      setVariantPeople,
      deleteVariant,
      setAssignment,
      clearAssignment,
      exportDatabase: repo.exportDatabase ? () => repo.exportDatabase!() : null,
    };
  }, [
    snapshot,
    repo,
    setProjects,
    resetProjectOrder,
    addVariant,
    renameVariant,
    setVariantPeople,
    deleteVariant,
    setAssignment,
    clearAssignment,
  ]);

  if (error) {
    return (
      <div className="db-splash">
        <p>Could not open the planner database.</p>
        <code>{error}</code>
      </div>
    );
  }

  // Holding children back until the snapshot is in means no component below
  // has to deal with a half-loaded store.
  if (!value) return <div className="db-splash">Loading…</div>;

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}
