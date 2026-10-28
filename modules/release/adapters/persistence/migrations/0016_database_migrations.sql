CREATE TABLE release.database_migrations (
 id text PRIMARY KEY, project_id text NOT NULL, service_id text NOT NULL,
 stage text NOT NULL CHECK(stage IN ('requested','provisioning','building','planning','awaiting-approval','approved','freezing','migrating','awaiting-reapproval','activating','verifying','ready-to-open','opening','completing','completed','rolling-back','rolled-back','abandoned')),
 revision integer NOT NULL CHECK(revision>0), body jsonb NOT NULL,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 CHECK(body->>'id'=id AND (body->>'revision')::integer=revision AND body->>'stage'=stage)
);
CREATE UNIQUE INDEX database_migration_one_active ON release.database_migrations(service_id) WHERE stage NOT IN ('completed','rolled-back','abandoned');
CREATE UNIQUE INDEX database_migration_job ON release.database_migrations((body->'currentAttempt'->>'jobId'));
CREATE TABLE release.database_migration_artifacts (
 operation_id text NOT NULL REFERENCES release.database_migrations(id) ON DELETE CASCADE,
 project_id text NOT NULL, name text NOT NULL, digest text NOT NULL CHECK(digest ~ '^sha256:[a-f0-9]{64}$'),
 size integer NOT NULL CHECK(size>=0), bytes bytea NOT NULL, PRIMARY KEY(operation_id,name), CHECK(octet_length(bytes)=size)
);
CREATE FUNCTION release.guard_database_migration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mutable text[]:=ARRAY['revision','stage','updatedAt','image','manifest','environmentBox','environmentVersion','plan','approval','currentAttempt','previousAttempts','prepared','rollbackRequest','freeze','switchActor','maintenanceRevision','candidateProof','receipts','error','observation','abandonRequested']; kept integer;
BEGIN
 IF (NEW.id,NEW.project_id,NEW.service_id,NEW.created_at,NEW.body-mutable) IS DISTINCT FROM (OLD.id,OLD.project_id,OLD.service_id,OLD.created_at,OLD.body-mutable) THEN RAISE EXCEPTION 'migration original input is immutable'; END IF;
 IF NEW.revision<>OLD.revision+1 OR OLD.stage IN ('completed','rolled-back','abandoned') THEN RAISE EXCEPTION 'migration revision or terminal state changed'; END IF;
 IF OLD.body->>'environmentBox' IS NOT NULL AND (NEW.body->>'environmentBox',NEW.body->>'environmentVersion') IS DISTINCT FROM (OLD.body->>'environmentBox',OLD.body->>'environmentVersion') THEN RAISE EXCEPTION 'migration environment is immutable'; END IF;
 IF OLD.body->>'image' IS NOT NULL AND NEW.body->>'image' IS DISTINCT FROM OLD.body->>'image' THEN RAISE EXCEPTION 'migration image is immutable'; END IF;
 IF OLD.body->>'manifest' IS NOT NULL AND NEW.body->'manifest' IS DISTINCT FROM OLD.body->'manifest' THEN RAISE EXCEPTION 'migration manifest is immutable'; END IF;
 IF OLD.body->>'freeze' IS NOT NULL AND NEW.body->'freeze' IS DISTINCT FROM OLD.body->'freeze' THEN RAISE EXCEPTION 'migration freeze is immutable'; END IF;
 IF OLD.body->>'prepared' IS NOT NULL AND NEW.body->'prepared' IS DISTINCT FROM OLD.body->'prepared' THEN RAISE EXCEPTION 'migration prepared receipt is immutable'; END IF;
 kept:=jsonb_array_length(OLD.body->'previousAttempts');
 IF jsonb_array_length(NEW.body->'previousAttempts')<kept OR COALESCE((SELECT jsonb_agg(item ORDER BY position) FROM jsonb_array_elements(NEW.body->'previousAttempts') WITH ORDINALITY AS attempts(item,position) WHERE position<=kept),'[]'::jsonb) IS DISTINCT FROM OLD.body->'previousAttempts' THEN RAISE EXCEPTION 'migration attempts are append-only'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER database_migration_identity BEFORE UPDATE ON release.database_migrations FOR EACH ROW EXECUTE FUNCTION release.guard_database_migration();
CREATE FUNCTION release.guard_database_operation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 -- Both operation kinds serialize on the same existing service row.
 PERFORM service_id FROM release.service_slots WHERE service_id=NEW.service_id FOR UPDATE;
 IF NEW.stage NOT IN ('completed','abandoned','rolled-back') THEN
  IF EXISTS(SELECT 1 FROM release.database_restores WHERE service_id=NEW.service_id AND (TG_TABLE_NAME<>'database_restores' OR id<>NEW.id) AND stage NOT IN ('completed','abandoned')) THEN RAISE EXCEPTION 'database_restore_active'; END IF;
  IF EXISTS(SELECT 1 FROM release.database_migrations WHERE service_id=NEW.service_id AND (TG_TABLE_NAME<>'database_migrations' OR id<>NEW.id) AND stage NOT IN ('completed','abandoned','rolled-back')) THEN RAISE EXCEPTION 'database_migration_active'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER database_operation_exclusive BEFORE INSERT OR UPDATE ON release.database_migrations FOR EACH ROW EXECUTE FUNCTION release.guard_database_operation();
CREATE TRIGGER database_operation_exclusive BEFORE INSERT OR UPDATE ON release.database_restores FOR EACH ROW EXECUTE FUNCTION release.guard_database_operation();
CREATE FUNCTION release.migration_artifact_write_once() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'write-once-conflict'; END $$;
CREATE TRIGGER migration_artifact_immutable BEFORE UPDATE ON release.database_migration_artifacts FOR EACH ROW EXECUTE FUNCTION release.migration_artifact_write_once();
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['database_migrations','database_migration_artifacts'] LOOP
  EXECUTE format('CREATE TRIGGER release_project_content BEFORE INSERT OR UPDATE OR DELETE ON release.%I FOR EACH ROW EXECUTE FUNCTION release.guard_project_content()',table_name);
  EXECUTE format('CREATE TRIGGER release_project_truncate BEFORE TRUNCATE ON release.%I FOR EACH STATEMENT EXECUTE FUNCTION release.reject_content_truncate()',table_name);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION release.deletion_key(kind text,body jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN kind='database_migration_artifacts' THEN release.deletion_json_text(jsonb_build_array(body->'operation_id',body->'name')) WHEN kind='observation_roles' THEN body->>'sequence' WHEN kind='replica_overrides' THEN release.deletion_json_text(jsonb_build_array(body->'service_id',body->'physical')) ELSE COALESCE(body->>'id',body->>'service_id') END
$$;
