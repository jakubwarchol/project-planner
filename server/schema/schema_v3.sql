-- Schema v3: track which project blocks which. No DB-level foreign key —
-- the app clears dangling references itself when a project is deleted, which
-- keeps this a plain ADD COLUMN instead of a table rebuild.
ALTER TABLE projects ADD COLUMN blocked_by TEXT;
