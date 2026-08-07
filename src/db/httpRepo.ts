import type { TeamVariant } from "../lib/estimation";
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

    createVariant: (variant: TeamVariant) => send("POST", "/api/variants", variant),
    renameVariant: (id, label) => send("PATCH", `/api/variants/${encodeURIComponent(id)}`, { label }),
    setVariantPeople: (id, category, people) =>
      send(
        "PUT",
        `/api/variants/${encodeURIComponent(id)}/people/${encodeURIComponent(category)}`,
        { people },
      ),
    deleteVariant: (id) => send("DELETE", `/api/variants/${encodeURIComponent(id)}`),

    setAssignment: (projectId, people) =>
      send("PUT", `/api/assignments/${encodeURIComponent(projectId)}`, { people }),
    clearAssignment: (projectId) =>
      send("DELETE", `/api/assignments/${encodeURIComponent(projectId)}`),
  };
}
