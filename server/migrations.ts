import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "schema");

// Index 0 takes the database to user_version 1, index 1 to version 2, and so
// on. Never edit a migration that has shipped — append a new one. The order is
// explicit rather than globbed because a directory listing sorts schema_v10
// before schema_v2, which would silently apply them out of order.
const MIGRATION_FILES = [
  "schema.sql",
  "schema_v2.sql",
  "schema_v3.sql",
  "schema_v4.sql",
  "schema_v5.sql",
  "schema_v6.sql",
  "schema_v7.sql",
  "schema_v8.sql",
  "schema_v9.sql",
  "schema_v10.sql",
  "schema_v11.sql",
  "schema_v12.sql",
  "schema_v13.sql",
  "schema_v14.sql",
  "schema_v15.sql",
  "schema_v16.sql",
  "schema_v17.sql",
];

export const MIGRATIONS: string[] = MIGRATION_FILES.map((file) =>
  readFileSync(join(SCHEMA_DIR, file), "utf8"),
);

export const LATEST_VERSION = MIGRATIONS.length;
