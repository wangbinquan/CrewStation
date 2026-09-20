ALTER TABLE data.task_bindings ADD COLUMN legacy_resource_id text;
UPDATE data.task_bindings SET legacy_resource_id = id;
