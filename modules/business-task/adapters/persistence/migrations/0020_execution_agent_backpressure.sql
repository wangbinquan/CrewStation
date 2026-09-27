ALTER TABLE business_task.execution_subtasks DROP CONSTRAINT execution_subtasks_dispatch_check;
ALTER TABLE business_task.execution_subtasks ADD CONSTRAINT execution_subtasks_dispatch_check CHECK (dispatch IN ('pending','dispatching','accepted','unknown','failed','retryable-rejected'));
