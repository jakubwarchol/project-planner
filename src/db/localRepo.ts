import type { BindParams, Database } from "sql.js";
import seedProjects from "../data/projects.json";
import { CATEGORY_ORDER, DEFAULT_TEAM_VARIANTS, type TeamVariant } from "../lib/estimation";
import type { Project } from "../types";
import type { PlannerRepository, PlannerSnapshot } from "./repository";
import { exportBytes, getDatabase, persist } from "./sqlite";

const SEED_PROJECTS = seedProjects as Project[];

function all(db: Database, sql: string, params?: BindParams): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  try {
    if (params) stmt.bind(params);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function run(db: Database, sql: string, params?: BindParams): void {
  db.run(sql, params);
  persist();
}

function seedIfEmpty(db: Database): void {
  const [projectCount] = all(db, "SELECT COUNT(*) AS n FROM projects");
  if (Number(projectCount.n) === 0) {
    SEED_PROJECTS.forEach((project, index) => {
      db.run(
        "INSERT INTO projects (id, name, category, estimate, position) VALUES (?, ?, ?, ?, ?)",
        [project.id, project.name, project.category, project.estimate, index],
      );
    });
  }

  const [variantCount] = all(db, "SELECT COUNT(*) AS n FROM variants");
  if (Number(variantCount.n) === 0) {
    DEFAULT_TEAM_VARIANTS.forEach((variant, index) => {
      insertVariant(db, variant, index);
    });
  }
}

function insertVariant(db: Database, variant: TeamVariant, position: number): void {
  db.run("INSERT INTO variants (id, label, position) VALUES (?, ?, ?)", [
    variant.id,
    variant.label,
    position,
  ]);
  for (const category of CATEGORY_ORDER) {
    db.run(
      "INSERT INTO variant_people (variant_id, category, people) VALUES (?, ?, ?)",
      [variant.id, category, Math.max(Math.round(variant.people[category] ?? 0), 0)],
    );
  }
}

function readVariants(db: Database): TeamVariant[] {
  const rows = all(
    db,
    `SELECT v.id, v.label, p.category, p.people
       FROM variants v
       LEFT JOIN variant_people p ON p.variant_id = v.id
      ORDER BY v.position, v.id`,
  );

  const byId = new Map<string, TeamVariant>();
  for (const row of rows) {
    const id = String(row.id);
    let variant = byId.get(id);
    if (!variant) {
      // Every category present, so callers never deal with holes.
      const people: Record<string, number> = {};
      for (const category of CATEGORY_ORDER) people[category] = 0;
      variant = { id, label: String(row.label), people };
      byId.set(id, variant);
    }
    if (row.category != null) variant.people[String(row.category)] = Number(row.people);
  }
  return [...byId.values()];
}

async function writeProjectOrder(orderedIds: string[]): Promise<void> {
  const db = await getDatabase();
  db.exec("BEGIN");
  try {
    orderedIds.forEach((id, index) => {
      db.run("UPDATE projects SET position = ? WHERE id = ?", [index, id]);
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  persist();
}

export function createLocalRepository(): PlannerRepository {
  return {
    async loadSnapshot(): Promise<PlannerSnapshot> {
      const db = await getDatabase();
      seedIfEmpty(db);
      persist();

      const projects = all(
        db,
        "SELECT id, name, category, estimate FROM projects ORDER BY position, id",
      ).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        category: String(row.category),
        estimate: String(row.estimate),
      })) as Project[];

      const assignments: Record<string, number> = {};
      for (const row of all(db, "SELECT project_id, people FROM assignments")) {
        assignments[String(row.project_id)] = Number(row.people);
      }

      return { projects, variants: readVariants(db), assignments };
    },

    setProjectOrder: writeProjectOrder,

    resetProjectOrder(): Promise<void> {
      return writeProjectOrder(SEED_PROJECTS.map((p) => p.id));
    },

    async createVariant(variant: TeamVariant): Promise<void> {
      const db = await getDatabase();
      const [row] = all(db, "SELECT COALESCE(MAX(position) + 1, 0) AS next FROM variants");
      db.exec("BEGIN");
      try {
        insertVariant(db, variant, Number(row.next));
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      persist();
    },

    async renameVariant(id: string, label: string): Promise<void> {
      run(await getDatabase(), "UPDATE variants SET label = ? WHERE id = ?", [label, id]);
    },

    async setVariantPeople(id: string, category: string, people: number): Promise<void> {
      run(
        await getDatabase(),
        `INSERT INTO variant_people (variant_id, category, people) VALUES (?, ?, ?)
           ON CONFLICT (variant_id, category) DO UPDATE SET people = excluded.people`,
        [id, category, people],
      );
    },

    async deleteVariant(id: string): Promise<void> {
      run(await getDatabase(), "DELETE FROM variants WHERE id = ?", [id]);
    },

    async setAssignment(projectId: string, people: number): Promise<void> {
      run(
        await getDatabase(),
        `INSERT INTO assignments (project_id, people) VALUES (?, ?)
           ON CONFLICT (project_id) DO UPDATE SET people = excluded.people`,
        [projectId, people],
      );
    },

    async clearAssignment(projectId: string): Promise<void> {
      run(await getDatabase(), "DELETE FROM assignments WHERE project_id = ?", [projectId]);
    },

    exportDatabase(): Promise<Uint8Array> {
      return exportBytes();
    },
  };
}
