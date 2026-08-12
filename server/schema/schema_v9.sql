-- Schema v9: external calendar constraints on a project.
--
-- earliest_start_month is hard — the scheduler gives the project nothing from
-- any pool until that month, because a contract date or a budget year is not
-- something re-planning can move. deadline_month is soft in the strictest
-- sense: nothing in the scheduler reads it. It exists so a date the plan
-- cannot meet is drawn on the timeline instead of going unrecorded.
--
-- Both are calendar months, 'YYYY-MM'. NULL means unconstrained, which is what
-- every existing project gets.

ALTER TABLE projects ADD COLUMN earliest_start_month TEXT;
ALTER TABLE projects ADD COLUMN deadline_month TEXT;
