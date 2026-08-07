import schemaV1 from "./schema.sql?raw";

// Index 0 takes the database to user_version 1, index 1 to version 2, and so
// on. Never edit a migration that has shipped — append a new one.
export const MIGRATIONS: string[] = [schemaV1];

export const LATEST_VERSION = MIGRATIONS.length;
