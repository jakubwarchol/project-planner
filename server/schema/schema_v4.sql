-- Schema v4: specialised FTE by capability.
--
-- Pools stop belonging to project categories and become global per
-- capability; `projects.category` survives only as a grouping label. Effort
-- is split per capability by a percentage mix, and each (project,
-- capability) cell also carries a concurrent FTE target. The old
-- `assignments` (one integer per project) and the category-keyed
-- `variant_people` have no meaning under that model, so they go.
--
-- No table with an ON DELETE CASCADE parent is rebuilt here, so the ambient
-- `PRAGMA foreign_keys = OFF` around each migration step (see sqlite.ts) is
-- not load-bearing for this step — but it does mean nothing below is
-- FK-checked while it runs, so it has to be correct on its own.

CREATE TABLE teams (
  id       TEXT PRIMARY KEY,                 -- 'ZWO' | 'ZP' | 'Inni'
  label    TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE people (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  team_id      TEXT NOT NULL REFERENCES teams (id) ON DELETE RESTRICT,
  capability   TEXT NOT NULL
               CHECK (capability IN ('PM','UX','TL','BE','FE','QA','SEC')),
  -- FTE this person contributes to their capability's pool.
  availability REAL NOT NULL DEFAULT 1.0
               CHECK (availability >= 0 AND availability <= 1),
  position     INTEGER NOT NULL
);

CREATE INDEX idx_people_capability ON people (capability);

-- One row per (project, capability). `mix_percent` is the share of the
-- project's overall work; `target_fte` is the concurrent FTE the scheduler
-- aims for. One table, not two: identical key, identical lifecycle, and the
-- seed rule ("target 1.0 wherever mix > 0") means neither can exist without
-- the other. 47 x 7 = 329 dense rows is kilobytes.
CREATE TABLE project_capability (
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  capability  TEXT NOT NULL
              CHECK (capability IN ('PM','UX','TL','BE','FE','QA','SEC')),
  mix_percent REAL NOT NULL DEFAULT 0
              CHECK (mix_percent >= 0 AND mix_percent <= 100),
  target_fte  REAL NOT NULL DEFAULT 0 CHECK (target_fte >= 0),
  PRIMARY KEY (project_id, capability)
);

-- Editable, re-appliable starting points for a mix row. `category` is the
-- project category this preset seeds on first run, and the target of the
-- "apply to whole category" action; NULL for presets the user adds later.
CREATE TABLE mix_presets (
  id       TEXT PRIMARY KEY,
  label    TEXT NOT NULL,
  category TEXT,
  position INTEGER NOT NULL
);

CREATE TABLE mix_preset_rows (
  preset_id   TEXT NOT NULL REFERENCES mix_presets (id) ON DELETE CASCADE,
  capability  TEXT NOT NULL
              CHECK (capability IN ('PM','UX','TL','BE','FE','QA','SEC')),
  mix_percent REAL NOT NULL
              CHECK (mix_percent >= 0 AND mix_percent <= 100),
  PRIMARY KEY (preset_id, capability)
);

-- Variant pools: capability-keyed and fractional. A new table name rather
-- than an in-place rebuild, because the *meaning* changed and not just the
-- type — `variant_people` keyed by category would be a lying name.
CREATE TABLE variant_capability_fte (
  variant_id TEXT NOT NULL REFERENCES variants (id) ON DELETE CASCADE,
  capability TEXT NOT NULL
             CHECK (capability IN ('PM','UX','TL','BE','FE','QA','SEC')),
  fte        REAL NOT NULL DEFAULT 0 CHECK (fte >= 0),
  PRIMARY KEY (variant_id, capability)
);

ALTER TABLE variants ADD COLUMN is_roster_derived INTEGER NOT NULL DEFAULT 0;

DROP TABLE variant_people;

-- The three seeded variants described category headcounts; both their labels
-- and their numbers are meaningless now. Clearing them lets seedIfEmpty put
-- the capability-keyed defaults in on the next load.
DELETE FROM variants;

-- Superseded by project_capability.target_fte. There is no honest way to
-- split one integer headcount across seven capabilities, and the seed rule
-- (1.0 FTE wherever mix > 0) is not derivable from it — do not try to
-- proportionally distribute the old number by mix.
DROP TABLE assignments;
