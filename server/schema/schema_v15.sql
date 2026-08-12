-- Schema v15: productivity moves from one global knob onto each person.
--
-- `estimation_settings.focus_factor` described the whole company with a single
-- number, which could not say that a tech lead spends half their day in
-- meetings while a developer next to them is heads-down. It becomes
-- `people.focus_factor`, and the scheduler now draws on a pool that is the
-- FTE-weighted sum of its people rather than a flat headcount times 0.7 (see
-- `effectivePools` in src/lib/estimation.ts).
--
-- Every existing person is seeded with the exact global value being retired,
-- so the weighted mean of any capability's people is that same number and
-- every pool comes out where it was. This migration therefore changes no
-- schedule — it only makes the number editable per person from here on.

ALTER TABLE people ADD COLUMN focus_factor REAL NOT NULL DEFAULT 0.7
  CHECK (focus_factor > 0 AND focus_factor <= 1);

-- COALESCE, not a bare subquery: a database whose settings row was never
-- written would otherwise silently set every person to NULL and fail the NOT
-- NULL constraint. 0.7 is the default the retired column carried.
UPDATE people
   SET focus_factor = COALESCE((SELECT focus_factor FROM estimation_settings WHERE id = 1), 0.7);

-- SQLite cannot DROP a column that a CHECK constraint names, so the settings
-- table is rebuilt without it — the same pattern v8 used to add one.
CREATE TABLE estimation_settings_v15 (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  days_per_value         REAL NOT NULL DEFAULT 6 CHECK (days_per_value > 0),
  working_days_per_month REAL NOT NULL DEFAULT 18 CHECK (working_days_per_month > 0),
  min_staffing_fraction  REAL NOT NULL DEFAULT 0.4
                         CHECK (min_staffing_fraction > 0 AND min_staffing_fraction <= 1)
);

INSERT INTO estimation_settings_v15 (id, days_per_value, working_days_per_month, min_staffing_fraction)
  SELECT id, days_per_value, working_days_per_month, min_staffing_fraction FROM estimation_settings;

DROP TABLE estimation_settings;
ALTER TABLE estimation_settings_v15 RENAME TO estimation_settings;
