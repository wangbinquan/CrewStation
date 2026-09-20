ALTER TABLE gateway.routes ADD COLUMN service_id text;
UPDATE gateway.routes SET service_id = service_name;
