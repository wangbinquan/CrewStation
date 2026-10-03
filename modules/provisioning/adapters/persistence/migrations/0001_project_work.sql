-- Original callbacks, closure and stop facts only; no owner phase or reclamation proof is fabricated.
CREATE SCHEMA IF NOT EXISTS provisioning;
CREATE TABLE provisioning.project_admissions (
 project_id text PRIMARY KEY, operation_id text NOT NULL, generation integer NOT NULL CHECK(generation>0), revision text NOT NULL
);
CREATE TABLE provisioning.original_callbacks (
 id text PRIMARY KEY, project_id text NOT NULL, service_id text NOT NULL,
 kind text NOT NULL, consumer_id text NOT NULL, backend_pid integer NOT NULL,
 original_process jsonb NOT NULL, input_digest text NOT NULL, exit_key_hash text NOT NULL,
 entered_at timestamptz NOT NULL DEFAULT clock_timestamp(), exited_at timestamptz, exit_digest text, recovery_digest text,
 CHECK((exited_at IS NULL)=(exit_digest IS NULL)),CHECK(recovery_digest IS NULL OR recovery_digest~'^[a-f0-9]{64}$')
);
CREATE INDEX provisioning_original_callbacks_project ON provisioning.original_callbacks(project_id);
CREATE FUNCTION provisioning.json_text(body jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result text;BEGIN
 IF jsonb_typeof(body)='object' THEN SELECT '{'||COALESCE(string_agg(to_jsonb(key)::text||':'||provisioning.json_text(item),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(body) AS entry(key,item);
 ELSIF jsonb_typeof(body)='array' THEN SELECT '['||COALESCE(string_agg(provisioning.json_text(item),',' ORDER BY ordinal),'')||']' INTO result FROM jsonb_array_elements(body) WITH ORDINALITY AS entry(item,ordinal);
 ELSE result:=body::text;END IF;RETURN result;
END $$;
CREATE FUNCTION provisioning.digest(body jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT encode(sha256(convert_to(provisioning.json_text(body),'UTF8')),'hex')
$$;
CREATE FUNCTION provisioning.callback_identity(body jsonb,recovery text DEFAULT NULL) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT provisioning.digest(jsonb_build_object('id',body->'id','kind',body->'kind','consumerId',body->'consumer_id',
 'projectId',body->'project_id','serviceId',body->'service_id','backendPid',body->'backend_pid',
 'process',body->'original_process','inputDigest',body->'input_digest','exitKeyDigest',body->'exit_key_hash')
 ||CASE WHEN recovery IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('recoveryDigest',recovery) END)
$$;
CREATE FUNCTION provisioning.locked(project text,lock_mode text,backend integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=backend AND granted AND mode=lock_mode
 AND classid=((hashtextextended('provisioning.project-admission:'||project,0)>>32)&4294967295)::oid
 AND objid=(hashtextextended('provisioning.project-admission:'||project,0)&4294967295)::oid AND objsubid=1)
$$;
CREATE FUNCTION provisioning.admitted(project text,backend integer) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE keys jsonb;BEGIN
 IF backend::text IS DISTINCT FROM current_setting('crewstation.shared_admission_pid',true) THEN RETURN false;END IF;
 BEGIN keys:=NULLIF(current_setting('crewstation.shared_admission_keys',true),'')::jsonb;EXCEPTION WHEN OTHERS THEN RETURN false;END;
 RETURN COALESCE(keys ? ('provisioning.project-admission:'||project),false) AND provisioning.locked(project,'ShareLock',backend);
END $$;
CREATE FUNCTION provisioning.birth_valid(body jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE resource_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';original jsonb:=body->'original_process';BEGIN
 IF jsonb_typeof(original) IS DISTINCT FROM 'object' OR NOT original ?& ARRAY['podUid','nodeUid','containerId','nodeName','pid','pidNamespace','bootId','startTicks'] OR original-ARRAY['podUid','nodeUid','containerId','nodeName','pid','pidNamespace','bootId','startTicks']<>'{}'::jsonb THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(original) AS field WHERE CASE WHEN to_jsonb(field)->>'key'='pid' THEN jsonb_typeof(to_jsonb(field)->'value') IS DISTINCT FROM 'number' ELSE jsonb_typeof(to_jsonb(field)->'value') IS DISTINCT FROM 'string' END) THEN RETURN false;END IF;
 RETURN body->>'id' ~ resource_pattern AND body->>'consumer_id' ~ resource_pattern AND body->>'project_id' ~ resource_pattern AND body->>'service_id' ~ resource_pattern AND(body->>'backend_pid')::integer>0 AND body->>'input_digest' ~ '^[a-f0-9]{64}$' AND body->>'exit_key_hash' ~ '^[a-f0-9]{64}$' AND original->>'podUid' ~ uuid_pattern AND original->>'nodeUid' ~ uuid_pattern AND original->>'bootId' ~ uuid_pattern AND original->>'containerId' ~ '^[a-z0-9]+://[a-f0-9]{64}$' AND length(original->>'nodeName') BETWEEN 1 AND 253 AND(original->>'pid')::integer>0 AND original->>'pidNamespace' ~ '^[0-9]+$' AND original->>'startTicks' ~ '^[0-9]+$';
EXCEPTION WHEN OTHERS THEN RETURN false;END $$;
-- Only the independent original container observer may append a minimal stop fact.
CREATE TABLE provisioning.callback_stops(identity text PRIMARY KEY,original_process jsonb NOT NULL,digest text NOT NULL);
CREATE FUNCTION provisioning.guard_stops() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP<>'INSERT' OR NEW.identity IS DISTINCT FROM provisioning.digest(NEW.original_process)
   OR NEW.digest!~'^[a-f0-9]{64}$' OR current_setting('crewstation.provisioning_callback_stop',true) IS DISTINCT FROM provisioning.digest(jsonb_build_object('process',NEW.original_process,'digest',NEW.digest))
   OR NEW.original_process-ARRAY['podUid','containerId','nodeUid','nodeName']<>'{}'::jsonb
   OR NOT NEW.original_process ?& ARRAY['podUid','containerId','nodeUid','nodeName'] THEN
  RAISE EXCEPTION 'Provisioning original stop fact requires the independent observer';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER provisioning_stop_guard BEFORE INSERT OR UPDATE OR DELETE ON provisioning.callback_stops FOR EACH ROW EXECUTE FUNCTION provisioning.guard_stops();
CREATE FUNCTION provisioning.guard_callbacks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_body jsonb;after_body jsonb;callback_key text:=current_setting('crewstation.provisioning_callback_exit',true);BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original provisioning callbacks require a completed metadata owner';END IF;
 after_body:=to_jsonb(NEW);
 IF TG_OP='INSERT' THEN
  IF provisioning.birth_valid(after_body) IS DISTINCT FROM true OR NEW.kind NOT IN('provision','enqueue','namespace-reapply') OR NEW.exited_at IS NOT NULL OR NEW.exit_digest IS NOT NULL OR NEW.recovery_digest IS NOT NULL OR NOT provisioning.admitted(NEW.project_id,NEW.backend_pid) THEN RAISE EXCEPTION 'Provisioning callback requires actual admitted original birth';END IF;
  IF EXISTS(SELECT 1 FROM provisioning.project_admissions WHERE project_id=NEW.project_id) THEN RAISE EXCEPTION 'Provisioning admission is permanently sealed';END IF;
  RETURN NEW;
 END IF;
 before_body:=to_jsonb(OLD);
 IF before_body-ARRAY['exited_at','exit_digest','recovery_digest'] IS DISTINCT FROM after_body-ARRAY['exited_at','exit_digest','recovery_digest'] OR OLD.exited_at IS NOT NULL OR NEW.exited_at IS NULL OR NEW.exit_digest IS DISTINCT FROM provisioning.callback_identity(before_body,NEW.recovery_digest) THEN RAISE EXCEPTION 'Original provisioning callback identity is immutable';END IF;
 IF NEW.recovery_digest IS NULL THEN
  IF callback_key IS NULL OR provisioning.digest(to_jsonb(callback_key)) IS DISTINCT FROM OLD.exit_key_hash THEN RAISE EXCEPTION 'Provisioning exit requires the private original finally';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM provisioning.callback_stops WHERE identity=current_setting('crewstation.provisioning_callback_recovery',true)
    AND digest=NEW.recovery_digest AND original_process=OLD.original_process-ARRAY['pid','pidNamespace','bootId','startTicks']) THEN
   RAISE EXCEPTION 'Provisioning recovery requires original stopped container proof';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION provisioning.guard_admissions() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR NOT provisioning.locked(NEW.project_id,'ExclusiveLock',pg_backend_pid()) OR
 current_setting('crewstation.provisioning_deletion_owner',true) IS DISTINCT FROM NEW.operation_id||':'||NEW.generation||':seal' THEN
  RAISE EXCEPTION 'Permanent closure requires the original exclusive deletion grant';END IF;
 IF TG_OP='UPDATE' AND(NEW.project_id<>OLD.project_id OR NEW.operation_id<>OLD.operation_id OR NEW.generation<=OLD.generation) THEN
  RAISE EXCEPTION 'Provisioning original operation and generation cannot be replaced';END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION provisioning.reject_truncate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Provisioning original facts cannot be truncated';END $$;
CREATE TRIGGER provisioning_callback_guard BEFORE INSERT OR UPDATE OR DELETE ON provisioning.original_callbacks FOR EACH ROW EXECUTE FUNCTION provisioning.guard_callbacks();
CREATE TRIGGER provisioning_admission_guard BEFORE INSERT OR UPDATE OR DELETE ON provisioning.project_admissions FOR EACH ROW EXECUTE FUNCTION provisioning.guard_admissions();
CREATE TRIGGER provisioning_callback_truncate BEFORE TRUNCATE ON provisioning.original_callbacks FOR EACH STATEMENT EXECUTE FUNCTION provisioning.reject_truncate();
CREATE TRIGGER provisioning_admission_truncate BEFORE TRUNCATE ON provisioning.project_admissions FOR EACH STATEMENT EXECUTE FUNCTION provisioning.reject_truncate();
CREATE TRIGGER provisioning_stop_truncate BEFORE TRUNCATE ON provisioning.callback_stops FOR EACH STATEMENT EXECUTE FUNCTION provisioning.reject_truncate();
