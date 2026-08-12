-- Schema v11: real per-person staffing — who is actually on what project,
-- and leave.
--
-- Layered on top of the capability-pool scheduler, not part of it: nothing
-- here feeds back into `projects`/`project_capability`, it only records who
-- is actually covering a capability need and when. Table is named
-- `staffing_assignments`, not `assignments` — that name is already taken by
-- the unrelated per-project headcount-grading table from schema v1.
--
-- Dates are `YYYY-MM-DD`; the end date is exclusive, matching the half-open
-- day-index convention used throughout the Obsada screen.

CREATE TABLE staffing_assignments (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  capability  TEXT NOT NULL,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  fte         REAL NOT NULL CHECK (fte > 0)
);

CREATE INDEX idx_staffing_assignments_person ON staffing_assignments (person_id);
CREATE INDEX idx_staffing_assignments_project ON staffing_assignments (project_id);

CREATE TABLE leaves (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  kind        TEXT NOT NULL
);

CREATE INDEX idx_leaves_person ON leaves (person_id);
