ALTER TABLE business_task.contracts ADD COLUMN legacy_agent_profiles jsonb, ADD COLUMN legacy_output_contracts jsonb, ADD COLUMN identity_provenance jsonb;
UPDATE business_task.contracts SET legacy_agent_profiles = agent_profiles, legacy_output_contracts = output_contracts;
ALTER TABLE business_task.subtasks ADD COLUMN legacy_spec jsonb, ADD COLUMN identity_provenance jsonb, ADD COLUMN identity_service_id text;
UPDATE business_task.subtasks SET legacy_spec = spec;
UPDATE business_task.subtasks AS target SET identity_service_id = source.service_id FROM business_task.tasks AS source WHERE target.task_id = source.id;
ALTER TABLE business_task.cluster_commands ADD COLUMN legacy_body jsonb, ADD COLUMN identity_provenance jsonb;
UPDATE business_task.cluster_commands SET legacy_body = body;

ALTER TABLE business_task.subtasks ADD COLUMN retry_operation_id text, ADD COLUMN retry_of text;
-- Recover accepted legacy retry intents, including a crash before resultId was saved.
UPDATE business_task.subtasks AS retry SET retry_operation_id = command.id, retry_of = original.id
FROM business_task.cluster_commands AS command JOIN business_task.subtasks AS original ON original.spec->'execution'->>'taskId' = command.body->'operation'->'target'->>'taskId'
WHERE command.body->'operation'->>'action' = 'restart' AND retry.id = 'sub_' || replace(command.id, '-', '');
CREATE UNIQUE INDEX subtasks_retry_operation ON business_task.subtasks (task_id, retry_operation_id);
