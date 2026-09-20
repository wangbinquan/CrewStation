ALTER TABLE cluster_management.snapshots ADD COLUMN legacy_body jsonb, ADD COLUMN identity_provenance jsonb;
UPDATE cluster_management.snapshots SET legacy_body = body;
ALTER TABLE cluster_management.inspections ADD COLUMN legacy_body jsonb, ADD COLUMN identity_provenance jsonb;
UPDATE cluster_management.inspections SET legacy_body = body;
ALTER TABLE cluster_management.operations ADD COLUMN legacy_body jsonb, ADD COLUMN identity_provenance jsonb;
UPDATE cluster_management.operations SET legacy_body = body;
ALTER TABLE cluster_management.operations ADD COLUMN identity_agent_restart jsonb, ADD COLUMN identity_domain_kind text;
UPDATE cluster_management.operations SET identity_agent_restart = jsonb_build_object('agentId', 'agt_' || replace(id, '-', ''), 'taskId', 'tsk_' || replace(id, '-', ''))
WHERE body->>'action' = 'restart' AND body->'target'->>'purpose' = 'development-agent' AND body->>'phase' <> 'queued';
UPDATE cluster_management.operations SET identity_domain_kind = CASE
  WHEN body->'target'->>'kind' = 'Deployment' OR (body->'target'->>'purpose' = 'development-workspace' AND body->>'action' = 'restart') THEN 'cluster-operation'
  WHEN body->'target'->>'purpose' = 'business-subtask' AND body->>'action' = 'restart' THEN 'subtask'
  ELSE 'task' END;

CREATE TABLE cluster_management.resource_identities (id text PRIMARY KEY, uid text NOT NULL UNIQUE, legacy_id text);
WITH resources AS (
  SELECT resource AS value FROM cluster_management.snapshots AS snapshot CROSS JOIN LATERAL jsonb_array_elements(snapshot.body->'resources') AS resource
  UNION ALL SELECT body->'target' FROM cluster_management.inspections
  UNION ALL SELECT body->'target' FROM cluster_management.operations
  UNION ALL SELECT body->'after' FROM cluster_management.operations
)
INSERT INTO cluster_management.resource_identities (id, uid, legacy_id)
SELECT DISTINCT ON (value->>'uid') value->>'resourceId', value->>'uid', value->>'resourceId'
FROM resources WHERE value->>'uid' IS NOT NULL AND value->>'resourceId' IS NOT NULL;

CREATE TABLE cluster_management.refresh_history (id text PRIMARY KEY);
INSERT INTO cluster_management.refresh_history (id) SELECT request_id FROM cluster_management.refreshes;
