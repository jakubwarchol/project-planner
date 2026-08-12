-- Schema v1.
-- Runs against the SQLite file the API server owns (`data/planner.sqlite`).
-- Keep it portable plain SQLite — no driver-specific syntax.

CREATE TABLE projects (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  category TEXT NOT NULL,
  estimate TEXT NOT NULL CHECK (estimate IN ('S', 'M', 'L', 'XL', 'XXL')),
  position INTEGER NOT NULL
);

CREATE INDEX idx_projects_position ON projects (position);

CREATE TABLE variants (
  id       TEXT PRIMARY KEY,
  label    TEXT NOT NULL,
  position INTEGER NOT NULL
);

-- One row per (variant, category) rather than a column per category, so
-- adding a category never needs a migration.
CREATE TABLE variant_people (
  variant_id TEXT NOT NULL REFERENCES variants (id) ON DELETE CASCADE,
  category   TEXT NOT NULL,
  people     INTEGER NOT NULL CHECK (people >= 0),
  PRIMARY KEY (variant_id, category)
);

-- How many people a project is graded with. Global for now, matching the UI:
-- when assignments need to differ per variant, add variant_id to the key.
CREATE TABLE assignments (
  project_id TEXT PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  people     INTEGER NOT NULL CHECK (people > 0)
);
