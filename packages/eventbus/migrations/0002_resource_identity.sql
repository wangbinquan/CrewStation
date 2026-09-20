ALTER TABLE platform_infra.domain_events ADD COLUMN legacy_payload jsonb, ADD COLUMN identity_provenance jsonb;
UPDATE platform_infra.domain_events SET legacy_payload = payload;
ALTER TABLE platform_infra.domain_events ADD COLUMN identity_project_id text, ADD COLUMN identity_service_id text;
UPDATE platform_infra.domain_events SET identity_project_id = payload->>'projectId', identity_service_id = payload->>'serviceId';
