-- Schema v12: drop the '2XL' tier. XXL and 2XL are the same t-shirt size under
-- two spellings, so the scale carried a duplicate rank. Everything sized 2XL
-- becomes XXL.
--
-- The rank is removed, not renamed: XXL keeps its own weight (31 → 186 days at
-- the default 6 days/point), so the six projects that were 2XL now reference
-- 186 days instead of 270. Nothing in the scheduler reads size — it plans from
-- the capability matrix — so this moves the reference figure and the
-- effortDrift warning, not the plan. Re-tune it on the Kompetencje
-- "ustawienia" tab if XXL should carry the old 2XL weight of 45.
--
-- SQLite has no ALTER TABLE for CHECK constraints, so both tables are rebuilt.
-- The migration runner disables foreign_keys around each step (see server/db.ts),
-- which is load-bearing here: project_capability and staffing_assignments
-- reference projects with ON DELETE CASCADE, and dropping the old table with
-- enforcement on would empty them.

UPDATE projects SET estimate = 'XXL' WHERE estimate = '2XL';

CREATE TABLE projects_v12 (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  category             TEXT NOT NULL,
  estimate             TEXT NOT NULL CHECK (estimate IN ('S', 'M', 'L', 'XL', 'XXL')),
  description          TEXT,
  position             INTEGER NOT NULL,
  blocked_by           TEXT,
  include_in_plan      INTEGER NOT NULL DEFAULT 1,
  earliest_start_month TEXT,
  deadline_month       TEXT,
  planned_start_month  TEXT
);

INSERT INTO projects_v12
  (id, name, category, estimate, description, position, blocked_by,
   include_in_plan, earliest_start_month, deadline_month, planned_start_month)
  SELECT id, name, category, estimate, description, position, blocked_by,
         include_in_plan, earliest_start_month, deadline_month, planned_start_month
    FROM projects;

DROP TABLE projects;
ALTER TABLE projects_v12 RENAME TO projects;

CREATE INDEX idx_projects_position ON projects (position);

-- Fold the retired row away before narrowing the CHECK, and keep whatever
-- weight XXL already carries (the user may have tuned it).
CREATE TABLE estimate_weights_v12 (
  estimate TEXT PRIMARY KEY CHECK (estimate IN ('S','M','L','XL','XXL')),
  weight   REAL NOT NULL CHECK (weight > 0)
);

INSERT INTO estimate_weights_v12 (estimate, weight)
  SELECT estimate, weight FROM estimate_weights WHERE estimate <> '2XL';

DROP TABLE estimate_weights;
ALTER TABLE estimate_weights_v12 RENAME TO estimate_weights;
