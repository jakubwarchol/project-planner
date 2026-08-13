import {
  CAPABILITY_ORDER,
  DEFAULT_ESTIMATION_SETTINGS,
  DEFAULT_PERSON_FOCUS_FACTOR,
  derivePoolsFromPeople,
  emptyCapabilityCells,
  emptyCapabilityVector,
  type TeamVariant,
} from "../src/lib/estimation";
import type { PlannerSnapshot } from "../src/db/repository";
import type {
  Capability,
  CapabilityAllocation,
  CapabilityCell,
  Estimate,
  EstimationSettings,
  Leave,
  Person,
  Project,
  StaffingAssignment,
  TeamCode,
} from "../src/types";
import type { Db } from "./db";

type Row = Record<string, unknown>;

export function all(db: Db, sql: string, params: unknown[] = []): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}

export function run(db: Db, sql: string, params: unknown[] = []): void {
  db.prepare(sql).run(...params);
}

/** SQLite has no boolean type and better-sqlite3 refuses to bind one. */
const bit = (value: boolean): number => (value ? 1 : 0);

// ---------------------------------------------------------------- reads

export function readPeople(db: Db): Person[] {
  const byPerson = new Map<string, CapabilityAllocation[]>();
  for (const row of all(
    db,
    "SELECT person_id, capability, fte FROM person_capability ORDER BY capability",
  )) {
    const id = String(row.person_id);
    const list = byPerson.get(id) ?? [];
    list.push({ capability: String(row.capability) as Capability, fte: Number(row.fte) });
    byPerson.set(id, list);
  }

  return all(
    db,
    "SELECT id, name, team_id, focus_factor FROM people ORDER BY position, id",
  ).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    teamId: String(row.team_id) as TeamCode,
    allocations: byPerson.get(String(row.id)) ?? [],
    focusFactor: Number(row.focus_factor),
  }));
}

function writeAllocations(db: Db, personId: string, allocations: CapabilityAllocation[]): void {
  run(db, "DELETE FROM person_capability WHERE person_id = ?", [personId]);
  const stmt = db.prepare(
    "INSERT INTO person_capability (person_id, capability, fte) VALUES (?, ?, ?)",
  );
  // A zero-FTE row would show up as "works in this capability, contributes
  // nothing" — an absent row says the same thing more honestly.
  for (const a of allocations) {
    if (a.fte > 0) stmt.run(personId, a.capability, a.fte);
  }
}

function readProjects(db: Db): Project[] {
  return all(
    db,
    "SELECT id, name, category, estimate, description, blocked_by, include_in_plan, earliest_start_date, deadline_date, planned_start_date FROM projects ORDER BY position, id",
  ).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    category: String(row.category),
    estimate: String(row.estimate),
    description: row.description == null ? undefined : String(row.description),
    blockedBy: row.blocked_by == null ? undefined : String(row.blocked_by),
    includeInPlan: Number(row.include_in_plan) !== 0,
    earliestStartDate:
      row.earliest_start_date == null ? undefined : String(row.earliest_start_date),
    deadlineDate: row.deadline_date == null ? undefined : String(row.deadline_date),
    plannedStartDate:
      row.planned_start_date == null ? undefined : String(row.planned_start_date),
  })) as Project[];
}

function readVariants(db: Db, people: Person[]): TeamVariant[] {
  const rows = all(
    db,
    `SELECT v.id, v.label, v.is_roster_derived, f.capability, f.fte
       FROM variants v
       LEFT JOIN variant_capability_fte f ON f.variant_id = v.id
      ORDER BY v.position, v.id`,
  );

  const byId = new Map<string, TeamVariant>();
  for (const row of rows) {
    const id = String(row.id);
    let variant = byId.get(id);
    if (!variant) {
      variant = {
        id,
        label: String(row.label),
        fte: emptyCapabilityVector(),
        isRosterDerived: Number(row.is_roster_derived) === 1,
      };
      byId.set(id, variant);
    }
    if (row.capability != null) variant.fte[row.capability as Capability] = Number(row.fte);
  }

  const derived = derivePoolsFromPeople(people);
  for (const variant of byId.values()) {
    if (variant.isRosterDerived) variant.fte = { ...derived };
  }
  return [...byId.values()];
}

function readSettings(db: Db): EstimationSettings {
  const [row] = all(
    db,
    `SELECT days_per_value, working_days_per_month, min_staffing_fraction, min_crew_fte
       FROM estimation_settings WHERE id = 1`,
  );
  const estimateValues = { ...DEFAULT_ESTIMATION_SETTINGS.estimateValues };
  for (const w of all(db, "SELECT estimate, weight FROM estimate_weights")) {
    estimateValues[String(w.estimate) as Estimate] = Number(w.weight);
  }
  return {
    estimateValues,
    daysPerValue: row ? Number(row.days_per_value) : DEFAULT_ESTIMATION_SETTINGS.daysPerValue,
    workingDaysPerMonth: row
      ? Number(row.working_days_per_month)
      : DEFAULT_ESTIMATION_SETTINGS.workingDaysPerMonth,
    minStaffingFraction: row
      ? Number(row.min_staffing_fraction)
      : DEFAULT_ESTIMATION_SETTINGS.minStaffingFraction,
    minCrewFte: row ? Number(row.min_crew_fte) : DEFAULT_ESTIMATION_SETTINGS.minCrewFte,
  };
}

function readCells(db: Db, projects: Project[]): Record<string, Record<Capability, CapabilityCell>> {
  const cells: Record<string, Record<Capability, CapabilityCell>> = {};
  for (const project of projects) cells[project.id] = emptyCapabilityCells();

  for (const row of all(
    db,
    "SELECT project_id, capability, effort_days, max_fte FROM project_capability",
  )) {
    const projectId = String(row.project_id);
    if (!cells[projectId]) continue;
    cells[projectId][row.capability as Capability] = {
      days: Number(row.effort_days),
      maxFte: Number(row.max_fte),
    };
  }
  return cells;
}

function readAssignments(db: Db): StaffingAssignment[] {
  return all(
    db,
    "SELECT id, person_id, project_id, capability, start_date, end_date, fte FROM staffing_assignments ORDER BY start_date, id",
  ).map((row) => ({
    id: String(row.id),
    personId: String(row.person_id),
    projectId: String(row.project_id),
    capability: String(row.capability) as Capability,
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    fte: Number(row.fte),
  }));
}

function readLeaves(db: Db): Leave[] {
  return all(
    db,
    "SELECT id, person_id, start_date, end_date, kind FROM leaves ORDER BY start_date, id",
  ).map((row) => ({
    id: String(row.id),
    personId: String(row.person_id),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    kind: String(row.kind),
  }));
}

export function loadSnapshot(db: Db): PlannerSnapshot {
  const projects = readProjects(db);
  const teams = all(db, "SELECT id, label FROM teams ORDER BY position, id").map((row) => ({
    id: String(row.id) as TeamCode,
    label: String(row.label),
  }));
  const people = readPeople(db);

  return {
    projects,
    teams,
    people,
    cells: readCells(db, projects),
    variants: readVariants(db, people),
    settings: readSettings(db),
    assignments: readAssignments(db),
    leaves: readLeaves(db),
  };
}

// ---------------------------------------------------------------- writes

export function insertVariant(db: Db, variant: TeamVariant, position: number): void {
  run(db, "INSERT INTO variants (id, label, position, is_roster_derived) VALUES (?, ?, ?, ?)", [
    variant.id,
    variant.label,
    position,
    bit(variant.isRosterDerived),
  ]);
  const stmt = db.prepare(
    "INSERT INTO variant_capability_fte (variant_id, capability, fte) VALUES (?, ?, ?)",
  );
  for (const capability of CAPABILITY_ORDER) {
    stmt.run(variant.id, capability, Math.max(variant.fte[capability] ?? 0, 0));
  }
}

function upsertCell(db: Db, projectId: string, capability: Capability, cell: CapabilityCell): void {
  run(
    db,
    `INSERT INTO project_capability (project_id, capability, effort_days, max_fte) VALUES (?, ?, ?, ?)
       ON CONFLICT (project_id, capability) DO UPDATE SET effort_days = excluded.effort_days, max_fte = excluded.max_fte`,
    [projectId, capability, cell.days, cell.maxFte],
  );
}

function nextPosition(db: Db, table: string): number {
  return Number(all(db, `SELECT COALESCE(MAX(position) + 1, 0) AS next FROM ${table}`)[0].next);
}

export function setProjectOrder(db: Db, orderedIds: string[]): void {
  const stmt = db.prepare("UPDATE projects SET position = ? WHERE id = ?");
  db.transaction(() => orderedIds.forEach((id, index) => stmt.run(index, id)))();
}

export function createProject(db: Db, project: Project, seedRow: (db: Db, id: string) => void): void {
  const position = nextPosition(db, "projects");
  db.transaction(() => {
    run(
      db,
      "INSERT INTO projects (id, name, category, estimate, description, blocked_by, position, earliest_start_date, deadline_date, planned_start_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        project.id,
        project.name,
        project.category,
        project.estimate,
        project.description ?? null,
        project.blockedBy ?? null,
        position,
        project.earliestStartDate ?? null,
        project.deadlineDate ?? null,
        project.plannedStartDate ?? null,
      ],
    );
    seedRow(db, project.id);
  })();
}

export function updateProject(db: Db, id: string, fields: Omit<Project, "id">): void {
  run(
    db,
    "UPDATE projects SET name = ?, category = ?, estimate = ?, description = ?, earliest_start_date = ?, deadline_date = ?, planned_start_date = ? WHERE id = ?",
    [
      fields.name,
      fields.category,
      fields.estimate,
      fields.description ?? null,
      fields.earliestStartDate ?? null,
      fields.deadlineDate ?? null,
      fields.plannedStartDate ?? null,
      id,
    ],
  );
}

export function deleteProject(db: Db, id: string): void {
  db.transaction(() => {
    run(db, "DELETE FROM projects WHERE id = ?", [id]);
    run(db, "UPDATE projects SET blocked_by = NULL WHERE blocked_by = ?", [id]);
  })();
}

export function setBlockedBy(db: Db, id: string, blockedById: string | null): void {
  run(db, "UPDATE projects SET blocked_by = ? WHERE id = ?", [blockedById, id]);
}

export function setIncludeInPlan(db: Db, id: string, includeInPlan: boolean): void {
  run(db, "UPDATE projects SET include_in_plan = ? WHERE id = ?", [bit(includeInPlan), id]);
}

export function createVariant(db: Db, variant: TeamVariant): void {
  const position = nextPosition(db, "variants");
  db.transaction(() => insertVariant(db, variant, position))();
}

export function renameVariant(db: Db, id: string, label: string): void {
  run(db, "UPDATE variants SET label = ? WHERE id = ?", [label, id]);
}

export function setVariantFte(db: Db, id: string, capability: Capability, fte: number): void {
  // Editing a capability by hand takes the variant off roster tracking —
  // otherwise the next reload would silently overwrite this edit.
  db.transaction(() => {
    const [row] = all(db, "SELECT is_roster_derived FROM variants WHERE id = ?", [id]);
    // A tracked variant's stored rows are stale — every read has been deriving
    // its pools from the roster since the row was written. Materialise today's
    // roster before detaching, so the six capabilities the edit didn't touch
    // keep the values the user was looking at instead of reverting.
    if (row && Number(row.is_roster_derived) === 1) {
      const derived = derivePoolsFromPeople(readPeople(db));
      const stmt = db.prepare(
        `INSERT INTO variant_capability_fte (variant_id, capability, fte) VALUES (?, ?, ?)
           ON CONFLICT (variant_id, capability) DO UPDATE SET fte = excluded.fte`,
      );
      for (const cap of CAPABILITY_ORDER) stmt.run(id, cap, derived[cap]);
    }
    run(
      db,
      `INSERT INTO variant_capability_fte (variant_id, capability, fte) VALUES (?, ?, ?)
         ON CONFLICT (variant_id, capability) DO UPDATE SET fte = excluded.fte`,
      [id, capability, fte],
    );
    run(db, "UPDATE variants SET is_roster_derived = 0 WHERE id = ?", [id]);
  })();
}

export function resetVariantFromRoster(db: Db, id: string): void {
  const derived = derivePoolsFromPeople(readPeople(db));
  const stmt = db.prepare(
    `INSERT INTO variant_capability_fte (variant_id, capability, fte) VALUES (?, ?, ?)
       ON CONFLICT (variant_id, capability) DO UPDATE SET fte = excluded.fte`,
  );
  db.transaction(() => {
    for (const capability of CAPABILITY_ORDER) stmt.run(id, capability, derived[capability]);
  })();
}

export function deleteVariant(db: Db, id: string): void {
  run(db, "DELETE FROM variants WHERE id = ?", [id]);
}

export function createPerson(db: Db, person: Person): void {
  const position = nextPosition(db, "people");
  db.transaction(() => {
    run(
      db,
      "INSERT INTO people (id, name, team_id, position, focus_factor) VALUES (?, ?, ?, ?, ?)",
      [
        person.id,
        person.name,
        person.teamId,
        position,
        person.focusFactor ?? DEFAULT_PERSON_FOCUS_FACTOR,
      ],
    );
    writeAllocations(db, person.id, person.allocations ?? []);
  })();
}

export function updatePerson(db: Db, id: string, fields: Omit<Person, "id">): void {
  db.transaction(() => {
    run(db, "UPDATE people SET name = ?, team_id = ?, focus_factor = ? WHERE id = ?", [
      fields.name,
      fields.teamId,
      fields.focusFactor ?? DEFAULT_PERSON_FOCUS_FACTOR,
      id,
    ]);
    if (fields.allocations) writeAllocations(db, id, fields.allocations);
  })();
}

export function deletePerson(db: Db, id: string): void {
  run(db, "DELETE FROM people WHERE id = ?", [id]);
}

/** Set one capability's share. An fte of 0 removes it, which is how the UI
 *  takes someone off a capability without a separate delete call. */
export function setPersonAllocation(
  db: Db,
  id: string,
  capability: Capability,
  fte: number,
): void {
  if (fte > 0) {
    run(
      db,
      `INSERT INTO person_capability (person_id, capability, fte) VALUES (?, ?, ?)
         ON CONFLICT (person_id, capability) DO UPDATE SET fte = excluded.fte`,
      [id, capability, fte],
    );
  } else {
    run(db, "DELETE FROM person_capability WHERE person_id = ? AND capability = ?", [id, capability]);
  }
}

export function createAssignment(db: Db, a: StaffingAssignment): void {
  run(
    db,
    "INSERT INTO staffing_assignments (id, person_id, project_id, capability, start_date, end_date, fte) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [a.id, a.personId, a.projectId, a.capability, a.startDate, a.endDate, a.fte],
  );
}

export function updateAssignment(
  db: Db,
  id: string,
  fields: Omit<StaffingAssignment, "id">,
): void {
  run(
    db,
    "UPDATE staffing_assignments SET person_id = ?, project_id = ?, capability = ?, start_date = ?, end_date = ?, fte = ? WHERE id = ?",
    [
      fields.personId,
      fields.projectId,
      fields.capability,
      fields.startDate,
      fields.endDate,
      fields.fte,
      id,
    ],
  );
}

export function deleteAssignment(db: Db, id: string): void {
  run(db, "DELETE FROM staffing_assignments WHERE id = ?", [id]);
}

export function createLeave(db: Db, leave: Leave): void {
  run(db, "INSERT INTO leaves (id, person_id, start_date, end_date, kind) VALUES (?, ?, ?, ?, ?)", [
    leave.id,
    leave.personId,
    leave.startDate,
    leave.endDate,
    leave.kind,
  ]);
}

export function updateLeave(db: Db, id: string, fields: Omit<Leave, "id">): void {
  run(db, "UPDATE leaves SET person_id = ?, start_date = ?, end_date = ?, kind = ? WHERE id = ?", [
    fields.personId,
    fields.startDate,
    fields.endDate,
    fields.kind,
    id,
  ]);
}

export function deleteLeave(db: Db, id: string): void {
  run(db, "DELETE FROM leaves WHERE id = ?", [id]);
}

export function setProjectCell(
  db: Db,
  projectId: string,
  capability: Capability,
  cell: CapabilityCell,
): void {
  upsertCell(db, projectId, capability, cell);
}

export function setProjectRow(
  db: Db,
  projectId: string,
  row: Record<Capability, CapabilityCell>,
): void {
  db.transaction(() => {
    for (const capability of CAPABILITY_ORDER) upsertCell(db, projectId, capability, row[capability]);
  })();
}

export function updateEstimationSettings(
  db: Db,
  fields: Omit<EstimationSettings, "estimateValues">,
): void {
  run(
    db,
    `INSERT INTO estimation_settings
       (id, days_per_value, working_days_per_month, min_staffing_fraction, min_crew_fte)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         days_per_value = excluded.days_per_value,
         working_days_per_month = excluded.working_days_per_month,
         min_staffing_fraction = excluded.min_staffing_fraction,
         min_crew_fte = excluded.min_crew_fte`,
    [fields.daysPerValue, fields.workingDaysPerMonth, fields.minStaffingFraction, fields.minCrewFte],
  );
}

export function setEstimateWeight(db: Db, estimate: Estimate, weight: number): void {
  run(
    db,
    `INSERT INTO estimate_weights (estimate, weight) VALUES (?, ?)
       ON CONFLICT (estimate) DO UPDATE SET weight = excluded.weight`,
    [estimate, weight],
  );
}
