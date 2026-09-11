CREATE TABLE IF NOT EXISTS gateway.allowlists (
  version integer PRIMARY KEY,
  document jsonb NOT NULL,
  generated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS gateway.pod_identities (
  namespace text NOT NULL,
  pod_name text NOT NULL,
  ip text NOT NULL,
  project text NOT NULL,
  service text NOT NULL,
  workload text NOT NULL,
  physical_slot text,
  task_id text,
  version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (namespace, pod_name)
);
CREATE INDEX IF NOT EXISTS pod_identities_ip_idx ON gateway.pod_identities (ip) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS gateway.routes (
  service_name text PRIMARY KEY,
  routes jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);
