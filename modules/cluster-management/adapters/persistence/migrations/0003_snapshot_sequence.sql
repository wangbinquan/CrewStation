ALTER TABLE cluster_management.snapshots ADD COLUMN sequence bigserial NOT NULL;
CREATE INDEX snapshots_sequence ON cluster_management.snapshots(sequence DESC);
