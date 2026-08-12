-- Schema v16: the crew model. `target_fte` becomes `max_fte`, and a new
-- `min_crew_fte` setting appears.
--
-- Nothing about the stored numbers changes — only what they mean, and the
-- change is a widening rather than a reinterpretation, so no data conversion
-- is possible or needed:
--
--   before  "run this capability at 2.0 FTE, finishing whenever its days run
--           out" — which meant a project's streams ended weeks apart and one
--           capability could keep a project open on its own long after the
--           rest of the team had left.
--   after   "never put more than 2.0 FTE on this capability" — a ceiling.
--           Whichever capability hits its ceiling first sets the phase's
--           length; everyone else's actual FTE is derived to finish alongside
--           it (src/lib/crew.ts).
--
-- A number that was a sensible target is a sensible ceiling: it was already
-- "the crew we want on this", and the derivation can only ever staff at or
-- below it. Plans will get shorter where a capability used to be the lonely
-- tail (its work now compresses into the phase) and no longer where it does
-- not bind at all.
--
-- SQLite has supported RENAME COLUMN since 3.25; better-sqlite3 ships well
-- past that, so no table rebuild is needed here.

ALTER TABLE project_capability RENAME COLUMN target_fte TO max_fte;

-- The FTE below which a capability stops being de-rated across its phase and
-- runs as a short burst instead. Four days of security review spread over a
-- five-month build is 0.06 FTE, which describes nothing real.
ALTER TABLE estimation_settings ADD COLUMN min_crew_fte REAL NOT NULL DEFAULT 0.1
  CHECK (min_crew_fte > 0 AND min_crew_fte <= 1);
