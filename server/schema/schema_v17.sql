-- Schema v17: variant ceiling overrides — the hire-plus-ceilings ladder's
-- second lever (docs/hiring-and-ceilings.md).
--
-- A team variant stops being a bare FTE vector: the ladder proposes raising
-- `max_fte` on specific project × capability cells, and an accepted proposal
-- must survive a reload. Overrides live on the variant, not on the matrix —
-- Wyceny keeps showing the real estimates, and only Symulacje plans with the
-- overlay.
--
-- The stored value is absolute (the ceiling to plan with), and reads apply
-- it only upward: an override at or below the matrix cell is stale — the
-- matrix has since been raised past it — and is ignored.

CREATE TABLE variant_project_ceiling (
  variant_id TEXT NOT NULL REFERENCES variants (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  max_fte    REAL NOT NULL CHECK (max_fte > 0),
  PRIMARY KEY (variant_id, project_id, capability)
);
