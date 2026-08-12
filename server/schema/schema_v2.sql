-- Schema v2: widen estimate to include 2XL and add an optional free-text
-- description. SQLite has no ALTER TABLE for CHECK constraints, so the table
-- is rebuilt in place.

CREATE TABLE projects_v2 (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  estimate    TEXT NOT NULL CHECK (estimate IN ('S', 'M', 'L', 'XL', 'XXL', '2XL')),
  description TEXT,
  position    INTEGER NOT NULL
);

INSERT INTO projects_v2 (id, name, category, estimate, position)
  SELECT id, name, category, estimate, position FROM projects;

DROP TABLE projects;
ALTER TABLE projects_v2 RENAME TO projects;

CREATE INDEX idx_projects_position ON projects (position);
