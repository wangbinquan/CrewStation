ALTER TABLE business_task.execution_subtasks ADD COLUMN runtime_dispatched boolean NOT NULL DEFAULT false;
ALTER TABLE business_task.execution_subtasks ADD COLUMN runtime_admitted boolean NOT NULL DEFAULT false;
ALTER TABLE business_task.execution_subtasks ADD COLUMN runtime_released boolean NOT NULL DEFAULT false;
