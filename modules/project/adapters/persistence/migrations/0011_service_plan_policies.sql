CREATE TABLE project.service_plan_policies (
  project_id text PRIMARY KEY,
  policy jsonb NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL
);
