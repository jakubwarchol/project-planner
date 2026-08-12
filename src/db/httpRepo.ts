import type { TeamVariant } from "../lib/estimation";
import type { Leave, Person, Project, StaffingAssignment } from "../types";
import type { PlannerRepository, PlannerSnapshot } from "./repository";

// The server-backed half of the swap. Set VITE_API_URL and the app talks to a
// service holding one shared SQLite file (the same schema.sql) instead of the
// per-browser copy. Endpoints below are the contract that service must expose.
export function createHttpRepository(baseUrl: string): PlannerRepository {
  const root = baseUrl.replace(/\/$/, "");

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${root}${path}`, {
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      ...init,
    });
    if (!response.ok) {
      throw new Error(`${init?.method ?? "GET"} ${path} failed: ${response.status}`);
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }

  const send = (method: string, path: string, body?: unknown) =>
    request<void>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

  return {
    loadSnapshot: () => request<PlannerSnapshot>("/api/snapshot"),

    setProjectOrder: (orderedIds: string[]) => send("PUT", "/api/projects/order", { orderedIds }),
    resetProjectOrder: () => send("POST", "/api/projects/order/reset"),

    createProject: (project: Project) => send("POST", "/api/projects", project),
    updateProject: (id, fields) => send("PATCH", `/api/projects/${encodeURIComponent(id)}`, fields),
    deleteProject: (id) => send("DELETE", `/api/projects/${encodeURIComponent(id)}`),
    setBlockedBy: (id, blockedById) =>
      send("PUT", `/api/projects/${encodeURIComponent(id)}/blocked-by`, { blockedById }),
    setIncludeInPlan: (id, includeInPlan) =>
      send("PUT", `/api/projects/${encodeURIComponent(id)}/include-in-plan`, { includeInPlan }),

    createVariant: (variant: TeamVariant) => send("POST", "/api/variants", variant),
    renameVariant: (id, label) => send("PATCH", `/api/variants/${encodeURIComponent(id)}`, { label }),
    setVariantFte: (id, capability, fte) =>
      send("PUT", `/api/variants/${encodeURIComponent(id)}/fte/${encodeURIComponent(capability)}`, { fte }),
    resetVariantFromRoster: (id) =>
      send("POST", `/api/variants/${encodeURIComponent(id)}/reset-from-roster`),
    deleteVariant: (id) => send("DELETE", `/api/variants/${encodeURIComponent(id)}`),

    createPerson: (person: Person) => send("POST", "/api/people", person),
    updatePerson: (id, fields) => send("PATCH", `/api/people/${encodeURIComponent(id)}`, fields),
    deletePerson: (id) => send("DELETE", `/api/people/${encodeURIComponent(id)}`),
    setPersonAllocation: (id, capability, fte) =>
      send(
        "PUT",
        `/api/people/${encodeURIComponent(id)}/allocations/${encodeURIComponent(capability)}`,
        { fte },
      ),

    createAssignment: (assignment: StaffingAssignment) => send("POST", "/api/staffing-assignments", assignment),
    updateAssignment: (id, fields) =>
      send("PATCH", `/api/staffing-assignments/${encodeURIComponent(id)}`, fields),
    deleteAssignment: (id) => send("DELETE", `/api/staffing-assignments/${encodeURIComponent(id)}`),

    createLeave: (leave: Leave) => send("POST", "/api/leaves", leave),
    updateLeave: (id, fields) => send("PATCH", `/api/leaves/${encodeURIComponent(id)}`, fields),
    deleteLeave: (id) => send("DELETE", `/api/leaves/${encodeURIComponent(id)}`),

    setProjectCell: (projectId, capability, cell) =>
      send(
        "PUT",
        `/api/projects/${encodeURIComponent(projectId)}/cells/${encodeURIComponent(capability)}`,
        cell,
      ),
    setProjectRow: (projectId, row) =>
      send("PUT", `/api/projects/${encodeURIComponent(projectId)}/cells`, { row }),

    updateEstimationSettings: (fields) => send("PATCH", "/api/estimation-settings", fields),
    setEstimateWeight: (estimate, weight) =>
      send("PUT", `/api/estimation-settings/weights/${encodeURIComponent(estimate)}`, { weight }),
  } satisfies PlannerRepository;
}
