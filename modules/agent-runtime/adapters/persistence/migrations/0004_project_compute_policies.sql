CREATE TABLE agent_runtime.project_compute_policies (
  project_id text PRIMARY KEY,
  revision integer NOT NULL,
  policy jsonb NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE agent_runtime.profiles ADD COLUMN default_visible boolean NOT NULL DEFAULT true;
ALTER TABLE agent_runtime.profiles ADD CONSTRAINT default_profile_visible CHECK (NOT is_default OR default_visible);
