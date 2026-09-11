CREATE TABLE IF NOT EXISTS project.projects (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL,
  namespace text NOT NULL,
  owner_user_id text NOT NULL,
  state text NOT NULL,
  template text NOT NULL,
  message text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS project.services (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  identity text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS services_project_idx ON project.services (project_id);
CREATE TABLE IF NOT EXISTS project.memberships (
  project_id text NOT NULL,
  user_id text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON project.memberships (user_id);
CREATE TABLE IF NOT EXISTS project.task_quotas (
  project_id text PRIMARY KEY,
  max_concurrent_tasks integer NOT NULL
);
CREATE TABLE IF NOT EXISTS project.service_plans (
  name text PRIMARY KEY,
  cpu text NOT NULL,
  memory text NOT NULL,
  max_replicas integer NOT NULL,
  description text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS project.task_profiles (
  name text PRIMARY KEY,
  cpu text NOT NULL,
  memory text NOT NULL,
  storage text NOT NULL,
  description text NOT NULL DEFAULT ''
);
