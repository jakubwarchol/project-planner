import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPABILITY_ORDER,
  DEFAULT_ESTIMATION_SETTINGS,
  DEFAULT_PERSON_FOCUS_FACTOR,
  ESTIMATE_ORDER,
  derivePoolsFromPeople,
  emptyCapabilityCells,
  type TeamVariant,
} from "../src/lib/estimation";
import type { Capability, Project, Team } from "../src/types";
import type { Db } from "./db";
import { all, insertVariant, readPeople } from "./repo";

// Read rather than `import ... with { type: "json" }` so the same file works
// under tsx, plain node and tsc without a resolveJsonModule flag.
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data");
const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(join(DATA_DIR, name), "utf8")) as T;

export const SEED_PROJECTS = readJson<Project[]>("projects.json");

// The seed file stays in the flat one-capability-per-person shape — it is a
// starting roster, and nobody in it splits their time. Splits are made in the
// app afterwards, so there is no reason to complicate the JSON.
interface SeedPerson {
  id: string;
  name: string;
  teamId: string;
  capability: Capability;
  availability: number;
}
const SEED_PEOPLE = readJson<SeedPerson[]>("people.json");

const SEED_TEAMS: Team[] = [
  { id: "ZWO", label: "Zespół Wytwarzania Oprogramowania (ZWO)" },
  { id: "ZP", label: "Zespół Produktu (ZP)" },
  { id: "Inni", label: "Inni" },
];

// Seed a project's capability row as empty — a project with no
// `project_capability` rows sums to 0 days and silently vanishes from the
// timeline, so every project must get one the moment it exists.
export function seedEmptyCapabilityRow(db: Db, projectId: string): void {
  const row = emptyCapabilityCells();
  const stmt = db.prepare(
    "INSERT INTO project_capability (project_id, capability, effort_days, max_fte) VALUES (?, ?, ?, ?)",
  );
  for (const capability of CAPABILITY_ORDER) {
    stmt.run(projectId, capability, row[capability].days, row[capability].maxFte);
  }
}

// Only ever fills gaps — every block is guarded by a count. Running against a
// database that already holds real work is a no-op, which is what makes it
// safe to call on every boot.
export function seedIfEmpty(db: Db): void {
  const count = (table: string) =>
    Number(all(db, `SELECT COUNT(*) AS n FROM ${table}`)[0].n);

  if (count("projects") === 0) {
    const stmt = db.prepare(
      "INSERT INTO projects (id, name, category, estimate, description, blocked_by, position) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    SEED_PROJECTS.forEach((project, index) => {
      stmt.run(
        project.id,
        project.name,
        project.category,
        project.estimate,
        project.description ?? null,
        project.blockedBy ?? null,
        index,
      );
    });
  }

  if (count("teams") === 0) {
    const stmt = db.prepare("INSERT INTO teams (id, label, position) VALUES (?, ?, ?)");
    SEED_TEAMS.forEach((team, index) => stmt.run(team.id, team.label, index));
  }

  if (count("people") === 0) {
    const person = db.prepare(
      "INSERT INTO people (id, name, team_id, position, focus_factor) VALUES (?, ?, ?, ?, ?)",
    );
    const allocation = db.prepare(
      "INSERT INTO person_capability (person_id, capability, fte) VALUES (?, ?, ?)",
    );
    SEED_PEOPLE.forEach((p, index) => {
      // The seed roster carries no productivity of its own — a starting team
      // is uniform until someone knows better, and the Zespół screen is where
      // they say so.
      person.run(p.id, p.name, p.teamId, index, DEFAULT_PERSON_FOCUS_FACTOR);
      allocation.run(p.id, p.capability, p.availability);
    });
  }

  // Per-project, not per-table: a pre-existing database has projects but no
  // project_capability rows the first time it reaches v6, and this is the same
  // path a newly created project needs.
  const missingRows = all(
    db,
    `SELECT p.id FROM projects p
      WHERE NOT EXISTS (SELECT 1 FROM project_capability c WHERE c.project_id = p.id)`,
  );
  for (const row of missingRows) seedEmptyCapabilityRow(db, String(row.id));

  if (count("estimation_settings") === 0) {
    db.prepare(
      `INSERT INTO estimation_settings
         (id, days_per_value, working_days_per_month, min_staffing_fraction)
         VALUES (1, ?, ?, ?)`,
    ).run(
      DEFAULT_ESTIMATION_SETTINGS.daysPerValue,
      DEFAULT_ESTIMATION_SETTINGS.workingDaysPerMonth,
      DEFAULT_ESTIMATION_SETTINGS.minStaffingFraction,
    );
  }

  if (count("estimate_weights") === 0) {
    const stmt = db.prepare("INSERT INTO estimate_weights (estimate, weight) VALUES (?, ?)");
    for (const estimate of ESTIMATE_ORDER) {
      stmt.run(estimate, DEFAULT_ESTIMATION_SETTINGS.estimateValues[estimate]);
    }
  }

  if (count("variants") === 0) {
    const derived = derivePoolsFromPeople(readPeople(db));
    const seedVariants: TeamVariant[] = [
      { id: "variant-1", label: "Wariant 1 — obecny zespół", fte: derived, isRosterDerived: true },
      {
        id: "variant-2",
        label: "Wariant 2 — +1 TL +1 UX",
        fte: { ...derived, TL: derived.TL + 1, UX: derived.UX + 1 },
        isRosterDerived: false,
      },
      {
        id: "variant-3",
        label: "Wariant 3 — +2 TL +2 UX +2 BE",
        fte: { ...derived, TL: derived.TL + 2, UX: derived.UX + 2, BE: derived.BE + 2 },
        isRosterDerived: false,
      },
    ];
    seedVariants.forEach((variant, index) => insertVariant(db, variant, index));
  }
}
