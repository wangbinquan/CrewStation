ALTER TABLE business_task.execution_logs ADD COLUMN task_state text;
ALTER TABLE business_task.execution_logs ADD COLUMN task_generation integer;
ALTER TABLE business_task.execution_logs ADD COLUMN task_polled_at timestamptz;
CREATE INDEX execution_task_poll ON business_task.execution_logs(task_polled_at) WHERE closed_at IS NULL AND NOT expired;
