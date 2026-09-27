CREATE TABLE runtime_environment.creation_requests (
  project_id text NOT NULL, actor_id text NOT NULL, request_key text NOT NULL,
  fingerprint text NOT NULL, image_id text NOT NULL, revision_id text NOT NULL,
  CONSTRAINT image_creation_request_unique UNIQUE (project_id, actor_id, request_key)
);
