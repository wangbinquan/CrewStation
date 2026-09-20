ALTER TABLE agent_runtime.profiles ADD COLUMN id text;
ALTER TABLE agent_runtime.profile_revisions ADD COLUMN normalized_content jsonb;
ALTER TABLE agent_runtime.profile_credentials ADD COLUMN id text;
ALTER TABLE agent_runtime.profile_credentials ALTER COLUMN cipher_text DROP NOT NULL;
-- A declared but unset credential is still a resource with an identity.
INSERT INTO agent_runtime.profile_credentials (profile, name, cipher_text, updated_by, updated_at)
SELECT DISTINCT ON (profile, symbol_name) profile, symbol_name, NULL, created_by, created_at
FROM agent_runtime.profile_revisions CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(content->'secretNames', '[]')) AS symbols(symbol_name)
ORDER BY profile, symbol_name, revision DESC
ON CONFLICT (profile, name) DO NOTHING;

-- Retired or pre-catalog profiles remain identifiable in immutable execution evidence.
-- These rows never become executable compute profiles.
CREATE TABLE agent_runtime.retired_profile_identities (id text NOT NULL, name text PRIMARY KEY);

CREATE TABLE agent_runtime.retired_test_identities (id text PRIMARY KEY);

CREATE TABLE agent_runtime.retired_step_identities (id text NOT NULL, profile text NOT NULL, name text NOT NULL, PRIMARY KEY (profile, name));
