CREATE TABLE business_task.storage_control_outbox (
  service_id text PRIMARY KEY,
  version bigint NOT NULL CHECK (version > 0),
  body jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX storage_control_outbox_updated ON business_task.storage_control_outbox (updated_at);
