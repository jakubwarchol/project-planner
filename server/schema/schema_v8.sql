-- Schema v8: minimum staffing fraction. The scheduler no longer lets a
-- project's phase start with only part of its capabilities present — it waits
-- until every one of them can be staffed at `target_fte * this fraction`, then
-- holds that staffing until the work is done. Rebuilt rather than ALTERed so
-- the new column gets the same CHECK treatment as focus_factor.

CREATE TABLE estimation_settings_v8 (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  days_per_value         REAL NOT NULL DEFAULT 6 CHECK (days_per_value > 0),
  focus_factor           REAL NOT NULL DEFAULT 0.7 CHECK (focus_factor > 0 AND focus_factor <= 1),
  working_days_per_month REAL NOT NULL DEFAULT 18 CHECK (working_days_per_month > 0),
  min_staffing_fraction  REAL NOT NULL DEFAULT 0.4
                         CHECK (min_staffing_fraction > 0 AND min_staffing_fraction <= 1)
);

INSERT INTO estimation_settings_v8 (id, days_per_value, focus_factor, working_days_per_month)
  SELECT id, days_per_value, focus_factor, working_days_per_month FROM estimation_settings;

DROP TABLE estimation_settings;
ALTER TABLE estimation_settings_v8 RENAME TO estimation_settings;
