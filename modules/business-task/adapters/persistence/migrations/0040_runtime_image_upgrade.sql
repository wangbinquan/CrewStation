-- RFC-043: a paused durable task can be repinned to another validated version of the same runtime image.
-- The admission snapshot in execution_operations.intent stays immutable. The current pin lives beside the
-- task's lifecycle state (NULL = never upgraded); an upgrade operation keeps its target in payload.
ALTER TABLE business_task.execution_task_states ADD COLUMN runtime_image jsonb;
ALTER TABLE business_task.execution_lifecycles ADD COLUMN payload jsonb;
