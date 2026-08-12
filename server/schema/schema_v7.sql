-- Schema v7: the t-shirt scale's tunable knobs (per-size weight, days per
-- weight unit, focus factor, working days per month) move from hardcoded
-- constants into the database, editable from the Kompetencje screen's
-- "ustawienia" tab.

CREATE TABLE estimation_settings (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  days_per_value         REAL NOT NULL DEFAULT 6 CHECK (days_per_value > 0),
  focus_factor           REAL NOT NULL DEFAULT 0.7 CHECK (focus_factor > 0 AND focus_factor <= 1),
  working_days_per_month REAL NOT NULL DEFAULT 18 CHECK (working_days_per_month > 0)
);

CREATE TABLE estimate_weights (
  estimate TEXT PRIMARY KEY CHECK (estimate IN ('S','M','L','XL','XXL','2XL')),
  weight   REAL NOT NULL CHECK (weight > 0)
);
