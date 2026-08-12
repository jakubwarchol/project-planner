-- Schema v5: let a project be parked out of the active plan without losing
-- its capability mix/target — it simply stops drawing from any pool. Default
-- 1 so every existing project stays exactly as scheduled today.
ALTER TABLE projects ADD COLUMN include_in_plan INTEGER NOT NULL DEFAULT 1;
