import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { MIGRATIONS } from "./migrations";

export type Db = Database.Database;

// One file on disk, and that is the whole persistence story — no in-memory
// copy to write back, no per-origin browser storage to lose. Override with
// PLANNER_DB to point a throwaway server at a scratch file.
export const DB_PATH = resolve(process.env.PLANNER_DB ?? "data/planner.sqlite");

// Bring an existing (or brand new) database up to the latest schema version,
// each step in its own transaction so a failure leaves the version behind.
function migrate(db: Db): void {
  const current = Number(db.pragma("user_version", { simple: true }));

  for (let version = current; version < MIGRATIONS.length; version++) {
    // foreign_keys is a no-op once a transaction is open, so it has to be
    // toggled outside BEGIN/COMMIT — otherwise recreating a table (the only
    // way to change a CHECK constraint in SQLite) cascade-deletes any rows
    // in tables that reference it via ON DELETE CASCADE.
    db.pragma("foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
}

let instance: Db | null = null;

export function getDatabase(): Db {
  if (instance) return instance;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);

  // WAL lets the timeline keep reading while an edit commits, and survives a
  // hard kill of the process without corrupting the file.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // A concurrent writer waits rather than throwing SQLITE_BUSY straight away.
  db.pragma("busy_timeout = 5000");

  migrate(db);
  instance = db;
  return db;
}

export function closeDatabase(): void {
  instance?.close();
  instance = null;
}
