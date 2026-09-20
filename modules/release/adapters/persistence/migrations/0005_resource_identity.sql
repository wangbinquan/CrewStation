ALTER TABLE release.releases ADD COLUMN legacy_manifest jsonb, ADD COLUMN identity_provenance jsonb;
UPDATE release.releases SET legacy_manifest = manifest;
ALTER TABLE release.slot_maintenance ADD COLUMN legacy_body jsonb, ADD COLUMN identity_provenance jsonb;
UPDATE release.slot_maintenance SET legacy_body = body;

ALTER TABLE release.releases ADD COLUMN legacy_resource_id text;
UPDATE release.releases SET legacy_resource_id = id;
