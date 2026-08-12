-- Schema v14: the three project calendar constraints become real dates.
--
-- They were `YYYY-MM` because the scheduler counts whole months from now, so a
-- month was as precise as anything downstream could represent. That is no
-- longer true: the scheduler works in fractional months throughout (a project
-- starting at 1.131 months is ordinary), so a specific day converts cleanly to
-- a fractional offset. Month granularity was a limitation of the edge, not of
-- the model.
--
-- Existing values take the first of their month, which is exactly what they
-- already meant: `monthsFrom` returned the offset of the month's start, and
-- day 01 converts to that same whole number. Every current plan is therefore
-- unchanged to the digit — see calendar.spec.ts, which pins that equivalence.
--
-- The columns are renamed rather than left as `*_month` holding a date; a
-- column whose name contradicts its contents is a trap for the next reader.

UPDATE projects
   SET earliest_start_month = earliest_start_month || '-01'
 WHERE earliest_start_month IS NOT NULL AND length(earliest_start_month) = 7;

UPDATE projects
   SET deadline_month = deadline_month || '-01'
 WHERE deadline_month IS NOT NULL AND length(deadline_month) = 7;

UPDATE projects
   SET planned_start_month = planned_start_month || '-01'
 WHERE planned_start_month IS NOT NULL AND length(planned_start_month) = 7;

ALTER TABLE projects RENAME COLUMN earliest_start_month TO earliest_start_date;
ALTER TABLE projects RENAME COLUMN deadline_month TO deadline_date;
ALTER TABLE projects RENAME COLUMN planned_start_month TO planned_start_date;
