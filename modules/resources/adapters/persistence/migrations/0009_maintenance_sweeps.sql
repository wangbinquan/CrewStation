CREATE TABLE resources.maintenance_sweeps (
  step text PRIMARY KEY CHECK (step IN ('retention', 'compaction')),
  scan_cutoff timestamptz NOT NULL,
  after_id text,
  epoch bigint NOT NULL DEFAULT 1 CHECK (epoch > 0),
  lease_holder text,
  lease_until timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  CHECK ((lease_holder IS NULL) = (lease_until IS NULL))
);

CREATE INDEX records_maintenance_retention_idx ON resources.records (id)
  WHERE desired = 'present' AND phase = 'failed' AND retain_until IS NOT NULL;
CREATE INDEX records_maintenance_compaction_idx ON resources.records (id)
  WHERE desired = 'absent' AND phase = 'stopped' AND compacted_at IS NULL;
