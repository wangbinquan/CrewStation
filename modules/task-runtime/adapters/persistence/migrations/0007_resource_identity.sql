ALTER TABLE task_runtime.environments ADD COLUMN legacy_native jsonb;
UPDATE task_runtime.environments SET legacy_native = native;
ALTER TABLE task_runtime.environments ADD COLUMN legacy_cluster jsonb;
UPDATE task_runtime.environments SET legacy_cluster = jsonb_strip_nulls(jsonb_build_object('taskId', id, 'rebuildId', rebuild_id, 'native', native));
ALTER TABLE task_runtime.environment_rebuilds ADD COLUMN legacy_input jsonb;
UPDATE task_runtime.environment_rebuilds SET legacy_input = input;
ALTER TABLE task_runtime.environment_rebuilds ADD COLUMN legacy_cluster jsonb;
UPDATE task_runtime.environment_rebuilds SET legacy_cluster = jsonb_build_object('taskId', task_id, 'rebuildId', id, 'profile', input->'profile');
CREATE UNIQUE INDEX rebuilds_project_request_idx ON task_runtime.environment_rebuilds(project_id, (input->>'requestId'));
