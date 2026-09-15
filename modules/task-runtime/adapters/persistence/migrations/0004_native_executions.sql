ALTER TABLE task_runtime.environments ADD COLUMN native jsonb;
ALTER TABLE task_runtime.environments ADD COLUMN release jsonb;
CREATE INDEX environments_native_parent ON task_runtime.environments ((native->>'parentTaskId')) WHERE native IS NOT NULL;
ALTER TABLE task_runtime.environment_rebuilds ADD COLUMN node_name text;
