CREATE TABLE runtime_environment.images (
  id text PRIMARY KEY, project_id text NOT NULL, name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('project','shared')), enabled boolean NOT NULL, payload jsonb NOT NULL
);
CREATE INDEX image_project_page ON runtime_environment.images(project_id, id DESC);
CREATE INDEX image_shared_page ON runtime_environment.images(scope, id DESC);
CREATE TABLE runtime_environment.revisions (
  id text PRIMARY KEY, image_id text NOT NULL REFERENCES runtime_environment.images(id),
  revision integer NOT NULL CHECK (revision > 0), payload jsonb NOT NULL,
  CONSTRAINT image_revision_unique UNIQUE(image_id, revision)
);
CREATE TABLE runtime_environment.builds (
  id text PRIMARY KEY, image_id text NOT NULL REFERENCES runtime_environment.images(id), project_id text NOT NULL,
  actor_id text NOT NULL, request_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','preparing','building','inspecting','succeeded','failed','cancelling','cancelled')),
  lease_until timestamptz, payload jsonb NOT NULL,
  CONSTRAINT image_build_request_unique UNIQUE(image_id, actor_id, request_key)
);
CREATE INDEX image_build_capacity ON runtime_environment.builds(project_id, state);
CREATE INDEX image_build_runnable ON runtime_environment.builds(state, lease_until, id);
CREATE TABLE runtime_environment.versions (
  id text PRIMARY KEY, image_id text NOT NULL REFERENCES runtime_environment.images(id), project_id text NOT NULL,
  build_id text NOT NULL REFERENCES runtime_environment.builds(id), repository text NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('available','disabled','retiring','retired')), payload jsonb NOT NULL,
  CONSTRAINT image_version_build_unique UNIQUE(build_id)
);
CREATE INDEX image_version_digest ON runtime_environment.versions(repository, digest);
CREATE INDEX image_version_page ON runtime_environment.versions(image_id, id DESC);
CREATE TABLE runtime_environment.validations (
  id text PRIMARY KEY, version_id text NOT NULL REFERENCES runtime_environment.versions(id), actor_id text NOT NULL,
  request_key text NOT NULL, contract_digest text NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','running','passed','failed','unknown','cancelling','cancelled')),
  lease_until timestamptz, payload jsonb NOT NULL,
  CONSTRAINT image_validation_request_unique UNIQUE(version_id, actor_id, request_key)
);
CREATE INDEX image_validation_lookup ON runtime_environment.validations(version_id, contract_digest, state);
CREATE INDEX image_validation_runnable ON runtime_environment.validations(state, lease_until, id);
CREATE TABLE runtime_environment.references (
  id text PRIMARY KEY, version_id text NOT NULL REFERENCES runtime_environment.versions(id), project_id text NOT NULL,
  owner_type text NOT NULL CHECK (owner_type IN ('release','task','agent','session','development-config','validation')), owner_id text NOT NULL, payload jsonb NOT NULL,
  CONSTRAINT image_reference_owner_unique UNIQUE(version_id, owner_type, owner_id)
);
CREATE TABLE runtime_environment.build_logs (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, build_id text NOT NULL REFERENCES runtime_environment.builds(id),
  stage text NOT NULL, text text NOT NULL, created_at timestamptz NOT NULL
);
CREATE INDEX image_log_cursor ON runtime_environment.build_logs(build_id, sequence);
CREATE TABLE runtime_environment.development_policies (project_id text PRIMARY KEY, payload jsonb NOT NULL);
