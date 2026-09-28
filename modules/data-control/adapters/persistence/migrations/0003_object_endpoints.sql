CREATE TABLE data_control.object_endpoints (
  backend_id text NOT NULL,
  placement_revision integer NOT NULL CHECK (placement_revision >= 1),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  PRIMARY KEY (backend_id, placement_revision)
);
