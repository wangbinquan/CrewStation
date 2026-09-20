CREATE TABLE release.replica_overrides (service_id text NOT NULL, physical text NOT NULL, replicas integer NOT NULL CHECK (replicas >= 1), UNIQUE(service_id, physical));
CREATE TABLE release.slot_maintenance (id text PRIMARY KEY, service_id text NOT NULL, state text NOT NULL, body jsonb NOT NULL);
CREATE UNIQUE INDEX slot_maintenance_active ON release.slot_maintenance(service_id) WHERE state IN ('prepared', 'applied');
