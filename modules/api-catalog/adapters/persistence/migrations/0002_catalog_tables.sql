CREATE TABLE IF NOT EXISTS api_catalog.proxies (
  proxy text PRIMARY KEY,
  project_id text NOT NULL,
  service_id text NOT NULL,
  kind text NOT NULL,
  upstream_connection text,
  document jsonb NOT NULL,
  state text NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS proxies_service_idx ON api_catalog.proxies (service_id);
CREATE TABLE IF NOT EXISTS api_catalog.operations (
  key text PRIMARY KEY,
  proxy text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  summary text,
  open_policy text NOT NULL,
  resource_note text,
  state text NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS operations_proxy_idx ON api_catalog.operations (proxy);
CREATE INDEX IF NOT EXISTS operations_state_idx ON api_catalog.operations (state);
CREATE TABLE IF NOT EXISTS api_catalog.grants (
  service_id text NOT NULL,
  operation_key text NOT NULL,
  state text NOT NULL,
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (service_id, operation_key)
);
CREATE TABLE IF NOT EXISTS api_catalog.requests (
  id text PRIMARY KEY,
  service_id text NOT NULL,
  project_id text NOT NULL,
  operation_key text NOT NULL,
  state text NOT NULL,
  reason text,
  requested_by text NOT NULL,
  decided_by text,
  decision text,
  created_at timestamptz NOT NULL,
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS requests_project_idx ON api_catalog.requests (project_id, created_at);
CREATE INDEX IF NOT EXISTS requests_service_operation_idx ON api_catalog.requests (service_id, operation_key, state);
