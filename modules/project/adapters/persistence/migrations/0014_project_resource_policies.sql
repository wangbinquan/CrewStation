CREATE TABLE project.namespace_quotas (
  project_id text PRIMARY KEY, revision integer NOT NULL, quota jsonb NOT NULL,
  updated_at timestamptz NOT NULL, actor_id text NOT NULL
);
CREATE TABLE project.resource_policy_receipts (
  operation_id text PRIMARY KEY, project_id text NOT NULL, body jsonb NOT NULL
);
