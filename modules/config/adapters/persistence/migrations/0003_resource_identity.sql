CREATE TABLE config.definitions (
  id text, project_id text NOT NULL, name text NOT NULL, binding_name text NOT NULL,
  PRIMARY KEY (project_id, binding_name)
);
INSERT INTO config.definitions (project_id, name, binding_name)
SELECT DISTINCT project_id, name, name FROM config.items
UNION SELECT DISTINCT project_id, name, name FROM config.version_entries;
ALTER TABLE config.items ADD COLUMN id text, ADD COLUMN definition_id text, ADD COLUMN binding_name text, ADD COLUMN identity_start text;
ALTER TABLE config.version_entries ADD COLUMN item_id text, ADD COLUMN definition_id text, ADD COLUMN binding_name text, ADD COLUMN identity_start text;
UPDATE config.items SET binding_name = name;
UPDATE config.version_entries SET binding_name = name;
-- Consecutive snapshots retain an item identity. Deletion followed by recreation starts a new lineage.
WITH boundaries AS (
  SELECT project_id, env, version, name, version - row_number() OVER (PARTITION BY project_id, env, name ORDER BY version) AS island
  FROM config.version_entries
), lineages AS (
  SELECT project_id, env, version, name, min(version) OVER (PARTITION BY project_id, env, name, island)::text AS first_version
  FROM boundaries
)
UPDATE config.version_entries AS target SET identity_start = source.first_version
FROM lineages AS source WHERE target.project_id = source.project_id AND target.env = source.env AND target.version = source.version AND target.name = source.name;
UPDATE config.items AS target SET identity_start = (
  SELECT identity_start FROM config.version_entries AS history
  WHERE history.project_id = target.project_id AND history.env = target.env AND history.name = target.name
  ORDER BY history.version DESC LIMIT 1
);
UPDATE config.items SET identity_start = version::text WHERE identity_start IS NULL;
