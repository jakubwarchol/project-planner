-- Schema v6: drop the percent-of-100 mix model in favor of absolute effort
-- days per capability, derived directly from project size. Existing
-- mix_percent values are converted to days using each project's size at
-- migration time, so nothing is silently zeroed out. The presets feature
-- (mix_presets / mix_preset_rows) is removed along with it — a percent-based
-- starting point has no equivalent once cells are absolute.

CREATE TABLE project_capability_v6 (
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  capability  TEXT NOT NULL
              CHECK (capability IN ('PM','UX','TL','BE','FE','QA','SEC')),
  effort_days REAL NOT NULL DEFAULT 0 CHECK (effort_days >= 0),
  target_fte  REAL NOT NULL DEFAULT 0 CHECK (target_fte >= 0),
  PRIMARY KEY (project_id, capability)
);

-- effort_days-per-value * 6 (see ESTIMATE_VALUES / DAYS_PER_VALUE in
-- estimation.ts) — kept in sync by hand since this runs before any app code.
INSERT INTO project_capability_v6 (project_id, capability, effort_days, target_fte)
  SELECT
    c.project_id,
    c.capability,
    c.mix_percent / 100.0 * (
      CASE p.estimate
        WHEN 'S' THEN 6 WHEN 'M' THEN 24 WHEN 'L' THEN 60
        WHEN 'XL' THEN 114 WHEN 'XXL' THEN 186 WHEN '2XL' THEN 270
        ELSE 0
      END
    ),
    c.target_fte
  FROM project_capability c
  JOIN projects p ON p.id = c.project_id;

DROP TABLE project_capability;
ALTER TABLE project_capability_v6 RENAME TO project_capability;

DROP TABLE mix_preset_rows;
DROP TABLE mix_presets;
