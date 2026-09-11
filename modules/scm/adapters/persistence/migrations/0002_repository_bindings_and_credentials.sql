CREATE TABLE IF NOT EXISTS scm.repository_bindings (
  service_id text PRIMARY KEY,
  project_id text NOT NULL,
  provider text NOT NULL DEFAULT 'gitlab',
  remote_project_id text NOT NULL,
  path_with_namespace text NOT NULL UNIQUE,
  http_url text NOT NULL,
  default_branch text NOT NULL,
  state text NOT NULL,
  message text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS repository_bindings_project_idx ON scm.repository_bindings (project_id);
CREATE TABLE IF NOT EXISTS scm.session_credentials (
  id text PRIMARY KEY,
  service_id text NOT NULL,
  remote_token_id text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS session_credentials_service_idx ON scm.session_credentials (service_id);
CREATE INDEX IF NOT EXISTS session_credentials_expiry_idx ON scm.session_credentials (expires_at) WHERE revoked_at IS NULL;
