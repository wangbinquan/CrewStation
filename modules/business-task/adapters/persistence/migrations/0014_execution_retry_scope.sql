ALTER TABLE business_task.execution_subtasks ADD COLUMN request_kind text NOT NULL DEFAULT 'submit' CHECK (request_kind IN ('submit','retry'));
ALTER TABLE business_task.execution_subtasks ADD COLUMN request_parent text NOT NULL DEFAULT '';
DROP INDEX business_task.execution_subtasks_request;
CREATE UNIQUE INDEX execution_subtasks_request ON business_task.execution_subtasks(service_id,task_id,request_kind,request_parent,request_key);
CREATE UNIQUE INDEX execution_subtasks_successor ON business_task.execution_subtasks(request_parent) WHERE request_kind='retry';
