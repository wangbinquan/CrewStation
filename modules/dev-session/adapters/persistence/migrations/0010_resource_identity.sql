ALTER TABLE dev_session.agent_starts ADD COLUMN legacy_profile jsonb, ADD COLUMN legacy_request jsonb;
UPDATE dev_session.agent_starts SET legacy_profile = profile, legacy_request = request;
ALTER TABLE dev_session.native_terminal_starts ADD COLUMN legacy_profile jsonb, ADD COLUMN legacy_input jsonb, ADD COLUMN legacy_record jsonb;
UPDATE dev_session.native_terminal_starts SET legacy_profile = profile, legacy_input = input, legacy_record = record;

CREATE TABLE dev_session.comparison_references (id text PRIMARY KEY, task_id text NOT NULL, runner_comparison_id text NOT NULL, target text NOT NULL, deployment text NOT NULL, created_at timestamptz NOT NULL, UNIQUE (task_id, runner_comparison_id, target, deployment));
CREATE INDEX comparison_references_age ON dev_session.comparison_references (created_at);

ALTER TABLE dev_session.workspace_layouts ADD COLUMN legacy_layout jsonb, ADD COLUMN identity_provenance jsonb;
UPDATE dev_session.workspace_layouts SET legacy_layout = layout;
ALTER TABLE dev_session.native_activity_states ADD COLUMN legacy_projection jsonb;
UPDATE dev_session.native_activity_states SET legacy_projection = projection;
ALTER TABLE dev_session.native_activity_items ADD COLUMN legacy_item jsonb;
UPDATE dev_session.native_activity_items SET legacy_item = item;

CREATE TABLE dev_session.cluster_agent_restarts (operation_id text PRIMARY KEY, agent_id text NOT NULL UNIQUE, task_id text NOT NULL UNIQUE);

ALTER TABLE dev_session.agent_starts ADD COLUMN compute_name text;
UPDATE dev_session.agent_starts SET compute_name = compute;
