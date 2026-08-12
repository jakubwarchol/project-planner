import { useCallback } from "react";
import { newId } from "../lib/id";
import { usePlanner } from "../state/plannerContext";
import type { Project } from "../types";

export type ProjectDraft = Omit<Project, "id">;

export interface ProjectCrudApi {
  addProject: (draft: ProjectDraft) => void;
  updateProject: (id: string, draft: ProjectDraft) => void;
  removeProject: (id: string) => void;
  setBlockedBy: (id: string, blockedById: string | null) => void;
  setIncludeInPlan: (id: string, includeInPlan: boolean) => void;
}

export function useProjectCrud(): ProjectCrudApi {
  const { addProject, updateProject, removeProject, setBlockedBy, setIncludeInPlan } = usePlanner();

  const create = useCallback(
    (draft: ProjectDraft) => addProject({ id: newId("project"), ...draft }),
    [addProject],
  );

  return { addProject: create, updateProject, removeProject, setBlockedBy, setIncludeInPlan };
}
