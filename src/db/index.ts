import { createHttpRepository } from "./httpRepo";
import type { PlannerRepository } from "./repository";

let repository: PlannerRepository | null = null;

// The server owns the database — one SQLite file on disk, not a per-browser
// copy. Same-origin by default: in dev Vite proxies /api to the API server, in
// production the API server serves the built app itself. VITE_API_URL is only
// needed to point the frontend at a different host.
export function getRepository(): PlannerRepository {
  if (!repository) {
    repository = createHttpRepository(import.meta.env.VITE_API_URL ?? "");
  }
  return repository;
}

export type { PlannerRepository, PlannerSnapshot } from "./repository";
