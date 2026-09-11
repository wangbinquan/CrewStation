CREATE TABLE IF NOT EXISTS egress.entries (
  id text PRIMARY KEY,
  fqdn text NOT NULL,
  scope text NOT NULL,
  project_id text NOT NULL DEFAULT '',
  note text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (fqdn, scope, project_id)
);
CREATE INDEX IF NOT EXISTS entries_project_idx ON egress.entries (project_id);
CREATE TABLE IF NOT EXISTS egress.requests (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  fqdn text NOT NULL,
  reason text,
  state text NOT NULL,
  requested_by text NOT NULL,
  decided_by text,
  decision text,
  created_at timestamptz NOT NULL,
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS requests_project_idx ON egress.requests (project_id, state);
CREATE TABLE IF NOT EXISTS egress.blocked (
  project_id text NOT NULL,
  fqdn text NOT NULL,
  count integer NOT NULL,
  last_seen_at timestamptz NOT NULL,
  source text,
  PRIMARY KEY (project_id, fqdn)
);
