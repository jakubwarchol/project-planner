import { createHttpRepository } from "./httpRepo";
import { createLocalRepository } from "./localRepo";
import type { PlannerRepository } from "./repository";

let repository: PlannerRepository | null = null;

// Local SQLite in the browser by default; point VITE_API_URL at the server
// once there is one and every call goes there instead. Nothing above this
// line knows which is in use.
export function getRepository(): PlannerRepository {
  if (!repository) {
    const apiUrl = import.meta.env.VITE_API_URL;
    repository = apiUrl ? createHttpRepository(apiUrl) : createLocalRepository();
  }
  return repository;
}

export type { PlannerRepository, PlannerSnapshot } from "./repository";
