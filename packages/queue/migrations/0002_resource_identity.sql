ALTER TABLE platform_infra.jobs ADD COLUMN legacy_payload jsonb, ADD COLUMN identity_provenance jsonb;
UPDATE platform_infra.jobs SET legacy_payload = payload;
