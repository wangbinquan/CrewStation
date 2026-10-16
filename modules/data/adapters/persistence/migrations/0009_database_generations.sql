-- RFC-042: existing logical resources and physical databases are not renamed or rebuilt.
CREATE TABLE data.database_generations (
 id text PRIMARY KEY, resource_id text NOT NULL REFERENCES data.resources(id),
 project_id text NOT NULL, service_id text NOT NULL, env text NOT NULL CHECK(env IN ('production','development')),
 object_name text NOT NULL, credential_resource_id text NOT NULL, secret_box text,
 origin text NOT NULL CHECK(origin IN ('existing','restore')),
 restore_operation_id text UNIQUE,
 state text NOT NULL CHECK(state IN ('provisioning','ready','active','retained')),
 identity jsonb, empty_proof jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(resource_id,id),
 CHECK((origin='restore')=(restore_operation_id IS NOT NULL))
);
CREATE TABLE data.database_environment_bindings (
 resource_id text PRIMARY KEY REFERENCES data.resources(id), project_id text NOT NULL, service_id text NOT NULL, env text NOT NULL,
 generation_id text NOT NULL REFERENCES data.database_generations(id), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 restore_operation_id text, last_restore_operation_id text, previous_generation_id text,
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(service_id,env)
);
INSERT INTO data.database_generations(id,resource_id,project_id,service_id,env,object_name,credential_resource_id,secret_box,origin,state,created_at,updated_at)
 SELECT id,id,project_id,service_id,env,object_name,id,secret_box,'existing','active',created_at,updated_at FROM data.resources WHERE kind='postgres';
INSERT INTO data.database_environment_bindings(resource_id,project_id,service_id,env,generation_id)
 SELECT id,project_id,service_id,env,id FROM data.resources WHERE kind='postgres';
CREATE FUNCTION data.guard_database_generation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND (NEW.id,NEW.resource_id,NEW.project_id,NEW.service_id,NEW.env,NEW.object_name,NEW.credential_resource_id,NEW.origin,NEW.restore_operation_id,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.resource_id,OLD.project_id,OLD.service_id,OLD.env,OLD.object_name,OLD.credential_resource_id,OLD.origin,OLD.restore_operation_id,OLD.created_at) THEN
 RAISE EXCEPTION 'database generation birth identity is immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD.identity IS NOT NULL AND NEW.identity IS DISTINCT FROM OLD.identity THEN RAISE EXCEPTION 'database generation physical identity is immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD.empty_proof IS NOT NULL AND NEW.empty_proof IS DISTINCT FROM OLD.empty_proof THEN RAISE EXCEPTION 'database generation empty proof is immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER database_generation_identity BEFORE UPDATE ON data.database_generations FOR EACH ROW EXECUTE FUNCTION data.guard_database_generation();
DO $$ DECLARE table_name text;BEGIN
 FOREACH table_name IN ARRAY ARRAY['database_generations','database_environment_bindings'] LOOP
  EXECUTE format('CREATE TRIGGER data_project_content BEFORE INSERT OR UPDATE OR DELETE ON data.%I FOR EACH ROW EXECUTE FUNCTION data.guard_content()',table_name);
  EXECUTE format('CREATE TRIGGER data_project_truncate BEFORE TRUNCATE ON data.%I FOR EACH STATEMENT EXECUTE FUNCTION data.reject_truncate()',table_name);
 END LOOP;
END $$;

-- Production access admission and restore reservation serialize on the same row.
ALTER TABLE data.task_bindings ADD COLUMN database_name text;
UPDATE data.task_bindings b SET database_name=r.object_name FROM data.resources r
 WHERE b.service_id=r.service_id AND r.env='production' AND r.kind='postgres' AND b.mode<>'development';
CREATE FUNCTION data.guard_production_binding_generation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reservation text; active_name text;
BEGIN
 IF TG_OP='UPDATE' AND OLD.database_name IS NOT NULL AND NEW.database_name IS DISTINCT FROM OLD.database_name THEN
  RAISE EXCEPTION 'production access target is immutable';
 END IF;
 IF NEW.mode<>'development' AND NEW.state IN ('requested','approved','active') THEN
  SELECT b.restore_operation_id,g.object_name INTO reservation,active_name
   FROM data.database_environment_bindings b JOIN data.database_generations g ON g.id=b.generation_id
   WHERE b.service_id=NEW.service_id AND b.env='production' FOR UPDATE OF b;
  IF reservation IS NOT NULL THEN RAISE EXCEPTION 'database_restore_active'; END IF;
  IF NEW.database_name IS NULL THEN NEW.database_name:=active_name; END IF;
  IF NEW.database_name IS DISTINCT FROM active_name THEN RAISE EXCEPTION 'production database generation changed'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER production_binding_generation BEFORE INSERT OR UPDATE ON data.task_bindings
 FOR EACH ROW EXECUTE FUNCTION data.guard_production_binding_generation();
