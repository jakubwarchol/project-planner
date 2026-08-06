import { useEffect, useState } from "react";
import seedProjects from "../data/projects.json";
import type { Project } from "../types";

const STORAGE_KEY = "project-planner:order";

function applyStoredOrder(projects: Project[], storedIds: string[]): Project[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const ordered: Project[] = [];

  for (const id of storedIds) {
    const project = byId.get(id);
    if (project) {
      ordered.push(project);
      byId.delete(id);
    }
  }

  // Any seed projects not present in the stored order (e.g. newly added) go at the end.
  ordered.push(...byId.values());
  return ordered;
}

function loadInitialOrder(): Project[] {
  const seed = seedProjects as Project[];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed;
    const storedIds = JSON.parse(raw) as string[];
    return applyStoredOrder(seed, storedIds);
  } catch {
    return seed;
  }
}

export function useOrderedProjects() {
  const [projects, setProjects] = useState<Project[]>(loadInitialOrder);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects.map((p) => p.id)));
  }, [projects]);

  function reorder(fromIndex: number, toIndex: number) {
    setProjects((current) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.length ||
        toIndex >= current.length
      ) {
        return current;
      }
      const next = current.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  function resetOrder() {
    localStorage.removeItem(STORAGE_KEY);
    setProjects(seedProjects as Project[]);
  }

  return { projects, reorder, resetOrder };
}
