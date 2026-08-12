-- Schema v13: a person can work in more than one capability.
--
-- Until now `people` carried a single `capability` plus an `availability`,
-- which made "half SEC, half BE" unrepresentable — the only workaround was
-- entering someone twice, which then doubles them in the Obsada lanes and
-- makes their leave need recording twice.
--
-- Allocation moves into its own table: one row per (person, capability) with
-- the FTE they give it. The old single capability becomes one row carrying the
-- old availability, so every existing person comes through unchanged and the
-- derived pools are identical before and after.
--
-- A person's availability is now the SUM of their rows. Nothing here enforces
-- that it stays under 1.0 — a CHECK can only see one row at a time, and a
-- trigger would fire mid-edit while the UI writes one capability at a time.
-- The Zespół screen flags an over-allocated person instead.
--
-- `people` is rebuilt to drop the two moved columns. staffing_assignments and
-- leaves both reference people(id) ON DELETE CASCADE, so this depends on the
-- migration runner disabling foreign_keys around each step (server/db.ts).

CREATE TABLE person_capability (
  person_id  TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  capability TEXT NOT NULL
             CHECK (capability IN ('PM','UX','TL','BE','FE','QA','SEC')),
  fte        REAL NOT NULL CHECK (fte >= 0 AND fte <= 1),
  PRIMARY KEY (person_id, capability)
);

-- Carry the existing roster across before `people` loses the columns.
INSERT INTO person_capability (person_id, capability, fte)
  SELECT id, capability, availability FROM people;

CREATE TABLE people_v13 (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  team_id  TEXT NOT NULL REFERENCES teams (id) ON DELETE RESTRICT,
  position INTEGER NOT NULL
);

INSERT INTO people_v13 (id, name, team_id, position)
  SELECT id, name, team_id, position FROM people;

DROP TABLE people;
ALTER TABLE people_v13 RENAME TO people;

-- Replaces idx_people_capability, which went with the dropped column.
CREATE INDEX idx_person_capability_capability ON person_capability (capability);
