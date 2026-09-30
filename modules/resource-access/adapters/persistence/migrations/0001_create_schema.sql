CREATE SCHEMA IF NOT EXISTS resource_access;
CREATE TABLE resource_access.changes (
  id text PRIMARY KEY, project_id text NOT NULL, actor_id text NOT NULL,
  request_key text NOT NULL, target_key text NOT NULL, state text NOT NULL,
  version integer NOT NULL, body jsonb NOT NULL, created_at timestamptz NOT NULL,
  UNIQUE (project_id, actor_id, request_key)
);
CREATE INDEX changes_project_page ON resource_access.changes (project_id, id DESC);
CREATE UNIQUE INDEX changes_one_inflight ON resource_access.changes (project_id, target_key)
  WHERE state IN ('pending', 'approved', 'applying', 'needs-review', 'apply-failed');
CREATE TABLE resource_access.catalog_policies (
  key text PRIMARY KEY, resource_type text NOT NULL, resource_id text NOT NULL,
  requestable integer NOT NULL, revision integer NOT NULL, actor_id text NOT NULL, updated_at timestamptz NOT NULL
);
