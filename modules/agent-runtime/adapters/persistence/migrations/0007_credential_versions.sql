CREATE TABLE agent_runtime.credential_versions (
  profile_id text NOT NULL,
  revision integer NOT NULL,
  stamp text NOT NULL,
  credentials jsonb NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  PRIMARY KEY(profile_id, revision, stamp)
);
