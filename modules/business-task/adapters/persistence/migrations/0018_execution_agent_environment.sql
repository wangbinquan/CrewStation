ALTER TABLE business_task.execution_subtasks ADD COLUMN runtime_task_id text;
CREATE UNIQUE INDEX execution_subtasks_runtime ON business_task.execution_subtasks(runtime_task_id) WHERE runtime_task_id IS NOT NULL;
