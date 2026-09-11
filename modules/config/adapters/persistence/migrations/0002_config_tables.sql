CREATE TABLE IF NOT EXISTS config.value_sets (
  project_id text NOT NULL,
  env text NOT NULL,
  current_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, env)
);
CREATE TABLE IF NOT EXISTS config.items (
  project_id text NOT NULL,
  env text NOT NULL,
  name text NOT NULL,
  is_secret boolean NOT NULL,
  value text NOT NULL,
  version integer NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, env, name)
);
CREATE TABLE IF NOT EXISTS config.versions (
  project_id text NOT NULL,
  env text NOT NULL,
  version integer NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, env, version)
);
CREATE TABLE IF NOT EXISTS config.version_entries (
  project_id text NOT NULL,
  env text NOT NULL,
  version integer NOT NULL,
  name text NOT NULL,
  is_secret boolean NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (project_id, env, version, name)
);
