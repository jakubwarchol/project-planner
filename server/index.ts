import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import type { TeamVariant } from "../src/lib/estimation";
import type {
  Capability,
  CapabilityCell,
  Estimate,
  EstimationSettings,
  Leave,
  Person,
  Project,
  StaffingAssignment,
} from "../src/types";
import { DB_PATH, closeDatabase, getDatabase } from "./db";
import * as repo from "./repo";
import { SEED_PROJECTS, seedEmptyCapabilityRow, seedIfEmpty } from "./seed";

const PORT = Number(process.env.PORT ?? 5174);
const DIST_DIR = resolve("dist");

const db = getDatabase();
seedIfEmpty(db);

// ---------------------------------------------------------------- routing

type Params = Record<string, string>;
type Handler = (params: Params, body: any) => unknown;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

const routes: Route[] = [];

// Registration order is not significant — patterns are matched on exact
// segment count, so `/api/projects/order` and `/api/projects/:id` can never
// both match the same path.
function route(method: string, pattern: string, handler: Handler): void {
  routes.push({ method, segments: pattern.split("/").filter(Boolean), handler });
}

function match(method: string, path: string): { handler: Handler; params: Params } | null {
  const parts = path.split("/").filter(Boolean);
  for (const candidate of routes) {
    if (candidate.method !== method || candidate.segments.length !== parts.length) continue;
    const params: Params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const segment = candidate.segments[i];
      if (segment.startsWith(":")) params[segment.slice(1)] = decodeURIComponent(parts[i]);
      else if (segment !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: candidate.handler, params };
  }
  return null;
}

// ---------------------------------------------------------------- endpoints
// These mirror src/db/httpRepo.ts exactly — that file is the contract.

route("GET", "/api/health", () => ({ ok: true, db: DB_PATH }));

route("GET", "/api/snapshot", () => repo.loadSnapshot(db));

route("PUT", "/api/projects/order", (_p, body: { orderedIds: string[] }) =>
  repo.setProjectOrder(db, body.orderedIds),
);
route("POST", "/api/projects/order/reset", () =>
  repo.setProjectOrder(db, SEED_PROJECTS.map((p) => p.id)),
);

route("POST", "/api/projects", (_p, body: Project) =>
  repo.createProject(db, body, seedEmptyCapabilityRow),
);
route("PATCH", "/api/projects/:id", (p, body: Omit<Project, "id">) =>
  repo.updateProject(db, p.id, body),
);
route("DELETE", "/api/projects/:id", (p) => repo.deleteProject(db, p.id));
route("PUT", "/api/projects/:id/blocked-by", (p, body: { blockedById: string | null }) =>
  repo.setBlockedBy(db, p.id, body.blockedById),
);
route("PUT", "/api/projects/:id/include-in-plan", (p, body: { includeInPlan: boolean }) =>
  repo.setIncludeInPlan(db, p.id, body.includeInPlan),
);

route("POST", "/api/variants", (_p, body: TeamVariant) => repo.createVariant(db, body));
route("PATCH", "/api/variants/:id", (p, body: { label: string }) =>
  repo.renameVariant(db, p.id, body.label),
);
route("PUT", "/api/variants/:id/fte/:capability", (p, body: { fte: number }) =>
  repo.setVariantFte(db, p.id, p.capability as Capability, body.fte),
);
route("POST", "/api/variants/:id/reset-from-roster", (p) => repo.resetVariantFromRoster(db, p.id));
route("DELETE", "/api/variants/:id", (p) => repo.deleteVariant(db, p.id));

route("POST", "/api/people", (_p, body: Person) => repo.createPerson(db, body));
route("PATCH", "/api/people/:id", (p, body: Omit<Person, "id">) =>
  repo.updatePerson(db, p.id, body),
);
route("DELETE", "/api/people/:id", (p) => repo.deletePerson(db, p.id));
route("PUT", "/api/people/:id/allocations/:capability", (p, body: { fte: number }) =>
  repo.setPersonAllocation(db, p.id, p.capability as Capability, body.fte),
);

route("POST", "/api/staffing-assignments", (_p, body: StaffingAssignment) =>
  repo.createAssignment(db, body),
);
route("PATCH", "/api/staffing-assignments/:id", (p, body: Omit<StaffingAssignment, "id">) =>
  repo.updateAssignment(db, p.id, body),
);
route("DELETE", "/api/staffing-assignments/:id", (p) => repo.deleteAssignment(db, p.id));

route("POST", "/api/leaves", (_p, body: Leave) => repo.createLeave(db, body));
route("PATCH", "/api/leaves/:id", (p, body: Omit<Leave, "id">) => repo.updateLeave(db, p.id, body));
route("DELETE", "/api/leaves/:id", (p) => repo.deleteLeave(db, p.id));

route("PUT", "/api/projects/:id/cells/:capability", (p, body: CapabilityCell) =>
  repo.setProjectCell(db, p.id, p.capability as Capability, body),
);

route("PATCH", "/api/estimation-settings", (_p, body: Omit<EstimationSettings, "estimateValues">) =>
  repo.updateEstimationSettings(db, body),
);
route("PUT", "/api/estimation-settings/weights/:estimate", (p, body: { weight: number }) =>
  repo.setEstimateWeight(db, p.estimate as Estimate, body.weight),
);

// ---------------------------------------------------------------- plumbing

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("error", rej);
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return res(undefined);
      try {
        res(JSON.parse(raw));
      } catch {
        rej(new Error("invalid JSON body"));
      }
    });
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// In dev, Vite serves the app and proxies /api here, so this never runs. After
// `npm run build` the same process serves dist/ too, which is what deployment
// will use.
function serveStatic(path: string, res: ServerResponse): boolean {
  if (!existsSync(DIST_DIR)) return false;

  const candidate = join(DIST_DIR, normalize(path));
  const file =
    candidate.startsWith(DIST_DIR) && existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : join(DIST_DIR, "index.html"); // SPA fallback

  if (!existsSync(file)) return false;
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
  return true;
}

const server = createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (method === "OPTIONS") return res.writeHead(204).end();

  const hit = match(method, path);
  if (!hit) {
    if (!path.startsWith("/api/") && serveStatic(path, res)) return;
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: `no route for ${method} ${path}` }));
  }

  try {
    const body = method === "GET" || method === "DELETE" ? undefined : await readBody(req);
    const result = hit.handler(hit.params, body);
    if (result === undefined) return res.writeHead(204).end();
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${method} ${path} failed:`, message);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
});

server.listen(PORT, () => {
  console.log(`planner api  →  http://localhost:${PORT}`);
  console.log(`database     →  ${DB_PATH}`);
});

// Closing checkpoints the WAL back into the main file. Skipping it loses
// nothing (SQLite replays the WAL on next open) but leaves the .sqlite file
// looking empty to anything that copies it for a backup.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    closeDatabase();
    process.exit(0);
  });
}
