ALTER TABLE task_runtime.environment_rebuilds ADD COLUMN creation text NOT NULL DEFAULT 'owner';
ALTER TABLE task_runtime.environment_rebuilds ADD COLUMN attempts integer NOT NULL DEFAULT 0;
