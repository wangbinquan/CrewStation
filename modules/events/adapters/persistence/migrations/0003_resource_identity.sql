ALTER TABLE events.producers ADD COLUMN id text, ADD COLUMN name text;
UPDATE events.producers SET name = producer;
ALTER TABLE events.event_types ADD COLUMN id text, ADD COLUMN name text, ADD COLUMN producer_id text, ADD COLUMN state text NOT NULL DEFAULT 'active';
-- Retain historical codes which were removed from the active declarations.
INSERT INTO events.event_types (event_type, producer, producer_project, state)
SELECT event_type, min(producer), min(producer_project), 'removed'
FROM events.inbox WHERE event_type NOT IN (SELECT event_type FROM events.event_types)
GROUP BY event_type HAVING count(DISTINCT producer) = 1;
UPDATE events.event_types SET name = event_type, producer_id = producer;
ALTER TABLE events.subscriptions ADD COLUMN event_type_id text;
UPDATE events.subscriptions SET event_type_id = event_type;
ALTER TABLE events.inbox ADD COLUMN producer_id text, ADD COLUMN event_type_id text;
UPDATE events.inbox SET producer_id = producer, event_type_id = event_type;
ALTER TABLE events.deliveries ADD COLUMN event_type_id text;
UPDATE events.deliveries SET event_type_id = event_type;
