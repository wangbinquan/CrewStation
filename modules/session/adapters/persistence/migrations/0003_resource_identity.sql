ALTER TABLE session.runner_events ADD COLUMN legacy_event jsonb, ADD COLUMN identity_provenance jsonb;
UPDATE session.runner_events SET legacy_event = event;

ALTER TABLE session.runner_events ADD COLUMN identity_profile text;
UPDATE session.runner_events SET identity_profile = legacy_event->'execution'->'profile'->>'profile';
