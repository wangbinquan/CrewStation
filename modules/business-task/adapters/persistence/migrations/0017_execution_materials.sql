CREATE TABLE business_task.execution_materials (
  id text PRIMARY KEY, service_id text NOT NULL, task_id text NOT NULL, request_key text NOT NULL,
  digest text NOT NULL, sealed text NOT NULL, size_bytes integer NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 1048576),
  created_at timestamptz NOT NULL, UNIQUE(service_id, task_id, request_key)
);
