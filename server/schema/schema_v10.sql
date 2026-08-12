-- Schema v10: planned start, a soft marker alongside deadline_month.
--
-- planned_start_month is management's intended start date. Like
-- deadline_month, nothing in the scheduler reads it — it exists purely so the
-- timeline can compare it against the computed start and surface the drift
-- between intent and what capacity can actually deliver.
--
-- Calendar month, 'YYYY-MM'. NULL means no planned start recorded.

ALTER TABLE projects ADD COLUMN planned_start_month TEXT;
