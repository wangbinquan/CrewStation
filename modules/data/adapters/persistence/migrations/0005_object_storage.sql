CREATE TABLE data.object_backends (
  id text PRIMARY KEY, request_key text NOT NULL UNIQUE,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  CHECK ((body->>'reservedBytes')::bigint >= 0), CHECK ((body->>'activeTransfers')::integer >= 0)
);
CREATE TABLE data.object_plans (
  id text PRIMARY KEY, backend_id text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object')
);
CREATE TABLE data.object_project_policies (
  project_id text PRIMARY KEY, body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object')
);
CREATE TABLE data.object_spaces (
  id text PRIMARY KEY, project_id text NOT NULL, service_id text NOT NULL,
  env text NOT NULL CHECK (env IN ('production', 'development')), backend_id text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  CHECK ((body->>'usedBytes')::bigint >= 0), CHECK ((body->>'reservedBytes')::bigint >= 0),
  CHECK ((body->>'deletingBytes')::bigint >= 0), CHECK ((body->>'activeTransfers')::integer >= 0)
);
CREATE UNIQUE INDEX object_spaces_service_env ON data.object_spaces(service_id, env);
CREATE INDEX object_spaces_project ON data.object_spaces(project_id, id);
CREATE INDEX object_spaces_backend ON data.object_spaces(backend_id);
CREATE TABLE data.object_uploads (
  id text PRIMARY KEY, space_id text NOT NULL, request_key text NOT NULL, state text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'), updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX object_uploads_space_request ON data.object_uploads(space_id, request_key);
CREATE INDEX object_uploads_work ON data.object_uploads(state, updated_at, id);
CREATE TABLE data.object_upload_attempts (
  id text PRIMARY KEY, upload_id text NOT NULL, space_id text NOT NULL, backend_id text NOT NULL,
  state text NOT NULL, lease_until timestamptz NOT NULL, body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object')
);
CREATE INDEX object_attempts_work ON data.object_upload_attempts(state, lease_until, id);
CREATE INDEX object_attempts_upload ON data.object_upload_attempts(upload_id, id);
CREATE TABLE data.objects (
  id text PRIMARY KEY, space_id text NOT NULL, state text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object')
);
CREATE INDEX objects_space_page ON data.objects(space_id, id);
CREATE INDEX objects_degraded_space ON data.objects(space_id) WHERE state = 'degraded';
CREATE TABLE data.object_references (
  object_id text NOT NULL, owner_type text NOT NULL, owner_id text NOT NULL, revision integer NOT NULL CHECK (revision >= 1),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object')
);
CREATE UNIQUE INDEX object_references_owner ON data.object_references(object_id, owner_type, owner_id, revision);
CREATE INDEX object_references_lookup ON data.object_references(owner_type, owner_id);
CREATE TABLE data.object_mutations (
  space_id text NOT NULL, request_key text NOT NULL, body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object')
);
CREATE UNIQUE INDEX object_mutations_request ON data.object_mutations(space_id, request_key);
CREATE TABLE data.object_read_transfers (
  id text PRIMARY KEY, object_id text NOT NULL, space_id text NOT NULL, backend_id text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object')
);
CREATE INDEX object_read_transfers_object ON data.object_read_transfers(object_id);
CREATE TABLE data.object_write_control (
  service_id text PRIMARY KEY, body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object')
);
CREATE TABLE data.object_storage_freezes (
  id text PRIMARY KEY, body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object')
);
CREATE TABLE data.archive_plans (
  id text PRIMARY KEY, task_id text NOT NULL, space_id text NOT NULL, request_key text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object')
);
CREATE UNIQUE INDEX archive_plans_task_request ON data.archive_plans(task_id, request_key);
CREATE TABLE data.finalization_bindings (
  id text PRIMARY KEY, task_id text NOT NULL, space_id text NOT NULL, state text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object')
);
CREATE UNIQUE INDEX finalization_bindings_active_task ON data.finalization_bindings(task_id) WHERE state <> 'aborted';
CREATE INDEX finalization_bindings_work ON data.finalization_bindings(state, id);
CREATE TABLE data.archive_binding_revisions (
  binding_id text NOT NULL, revision integer NOT NULL, request_key text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  PRIMARY KEY (binding_id, revision)
);
CREATE UNIQUE INDEX archive_binding_revisions_request ON data.archive_binding_revisions(binding_id, request_key);
CREATE TABLE data.archive_helper_grants (
  id text PRIMARY KEY, binding_id text NOT NULL, revision integer NOT NULL CHECK (revision > 0),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object')
);
CREATE INDEX archive_helper_grants_binding ON data.archive_helper_grants(binding_id, revision);
CREATE TABLE data.archive_helper_closures (id text PRIMARY KEY);
CREATE TABLE data.archive_file_results (
  binding_id text NOT NULL, revision integer NOT NULL CHECK (revision > 0), path text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'), PRIMARY KEY (binding_id, revision, path)
);
CREATE INDEX object_uploads_archive ON data.object_uploads ((body->'archive'->>'bindingId'), ((body->'archive'->>'revision')::integer));
CREATE TABLE data.object_credential_rotations (
  backend_id text NOT NULL, request_key text NOT NULL, body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  PRIMARY KEY (backend_id, request_key)
);

CREATE TABLE data.storage_contract (
  id text PRIMARY KEY CHECK (id='service-object-storage'), required_version integer NOT NULL CHECK (required_version>=0),
  enabled boolean NOT NULL, enabled_at timestamptz
);
INSERT INTO data.storage_contract (id,required_version,enabled) VALUES ('service-object-storage',0,false);

CREATE TABLE data.object_backups (
  id text PRIMARY KEY, request_key text NOT NULL UNIQUE, state text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object')
);
CREATE UNIQUE INDEX object_backups_one_active ON data.object_backups ((true)) WHERE state IN ('draining','exporting');

CREATE TABLE data.task_object_inputs (
  task_id text PRIMARY KEY, body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object')
);
CREATE TABLE data.task_input_grants (
  id text PRIMARY KEY, task_id text NOT NULL REFERENCES data.task_object_inputs(task_id),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object')
);

CREATE TABLE data.object_transfer_stops (
  pod_uid text PRIMARY KEY, proof_digest text NOT NULL, observed_at timestamptz NOT NULL
);
