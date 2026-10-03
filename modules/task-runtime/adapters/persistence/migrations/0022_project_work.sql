-- RFC-037: original execution, reconcile and outstanding-effect callbacks and private exits; these are not successful deletion phases.
CREATE TABLE task_runtime.project_admissions (
 project_id text PRIMARY KEY, operation_id text NOT NULL, generation integer NOT NULL CHECK(generation>0), revision text NOT NULL
);
CREATE TABLE task_runtime.original_callbacks (
 id text PRIMARY KEY, project_id text NOT NULL, origin_kind text NOT NULL, origin_key text NOT NULL, origin_id text NOT NULL, kind text NOT NULL,
 reference text NOT NULL, consumer_id text NOT NULL, input_digest text NOT NULL, origin_revision text NOT NULL,
 backend_pid integer NOT NULL, original_process jsonb NOT NULL, exit_key_hash text NOT NULL, deletion_grant jsonb,
 entered_at timestamptz NOT NULL DEFAULT clock_timestamp(), exited_at timestamptz, exit_digest text, recovery_digest text,
 CHECK((exited_at IS NULL)=(exit_digest IS NULL)), CHECK(recovery_digest IS NULL OR recovery_digest~'^[a-f0-9]{64}$')
);
CREATE INDEX task_runtime_callbacks_project ON task_runtime.original_callbacks(project_id,id);
CREATE TABLE task_runtime.callback_pod_stops(identity text PRIMARY KEY,original_process jsonb NOT NULL,digest text NOT NULL);
CREATE FUNCTION task_runtime.work_json_text(body jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result text;BEGIN
 IF jsonb_typeof(body)='object' THEN SELECT '{'||COALESCE(string_agg(to_jsonb(key)::text||':'||task_runtime.work_json_text(item),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(body) AS entry(key,item);
 ELSIF jsonb_typeof(body)='array' THEN SELECT '['||COALESCE(string_agg(task_runtime.work_json_text(item),',' ORDER BY ordinal),'')||']' INTO result FROM jsonb_array_elements(body) WITH ORDINALITY AS entry(item,ordinal);
 ELSE result:=body::text;END IF;RETURN result;
END $$;
CREATE FUNCTION task_runtime.work_digest(body jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT encode(sha256(convert_to(task_runtime.work_json_text(body),'UTF8')),'hex')
$$;
CREATE FUNCTION task_runtime.work_identity(body jsonb,recovery text DEFAULT NULL) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT task_runtime.work_digest(jsonb_build_object('id',body->'id','projectId',body->'project_id','originKind',body->'origin_kind','originKey',body->'origin_key','originId',body->'origin_id',
 'kind',body->'kind','reference',body->'reference','consumerId',body->'consumer_id','inputDigest',body->'input_digest',
 'originRevision',body->'origin_revision','backendPid',body->'backend_pid','process',body->'original_process','exitKeyDigest',body->'exit_key_hash','grant',body->'deletion_grant')
 ||CASE WHEN recovery IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('recoveryDigest',recovery) END)
$$;
CREATE FUNCTION task_runtime.work_locked(project text,lock_mode text,backend integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=backend AND granted AND mode=lock_mode
 AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
 AND classid=((hashtextextended('task-runtime.project-admission:'||project,0)>>32)&4294967295)::oid
 AND objid=(hashtextextended('task-runtime.project-admission:'||project,0)&4294967295)::oid AND objsubid=1)
$$;
CREATE FUNCTION task_runtime.work_admitted(project text,backend integer) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE keys jsonb;BEGIN
 IF backend::text IS DISTINCT FROM current_setting('crewstation.shared_admission_pid',true) THEN RETURN false;END IF;
 BEGIN keys:=NULLIF(current_setting('crewstation.shared_admission_keys',true),'')::jsonb;EXCEPTION WHEN OTHERS THEN RETURN false;END;
 RETURN COALESCE(keys ? ('task-runtime.project-admission:'||project),false) AND task_runtime.work_locked(project,'ShareLock',backend);
END $$;
CREATE FUNCTION task_runtime.work_birth_valid(body jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE resource_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';original jsonb:=body->'original_process';BEGIN
 IF jsonb_typeof(original) IS DISTINCT FROM 'object' OR NOT original ?& ARRAY['podUid','nodeUid','containerId','nodeName','pid','pidNamespace','bootId','startTicks'] OR original-ARRAY['podUid','nodeUid','containerId','nodeName','pid','pidNamespace','bootId','startTicks']<>'{}'::jsonb THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(original) AS field WHERE CASE WHEN to_jsonb(field)->>'key'='pid' THEN jsonb_typeof(to_jsonb(field)->'value') IS DISTINCT FROM 'number' ELSE jsonb_typeof(to_jsonb(field)->'value') IS DISTINCT FROM 'string' END) THEN RETURN false;END IF;
 RETURN body->>'id' ~ resource_pattern AND body->>'reference' ~ resource_pattern AND body->>'consumer_id' ~ resource_pattern AND body->>'project_id' ~ resource_pattern AND body->>'origin_id' ~ resource_pattern AND body->>'origin_kind' IN('project','service','task','rebuild','parent-ending') AND length(body->>'origin_key')>0
 AND(body->>'backend_pid')::integer>0 AND body->>'input_digest' ~ '^[a-f0-9]{64}$' AND body->>'origin_revision' ~ '^[a-f0-9]{64}$' AND body->>'exit_key_hash' ~ '^[a-f0-9]{64}$'
 AND original->>'podUid' ~ uuid_pattern AND original->>'nodeUid' ~ uuid_pattern AND original->>'bootId' ~ uuid_pattern AND original->>'containerId' ~ '^[a-z0-9]+://[a-f0-9]{64}$'
 AND length(original->>'nodeName') BETWEEN 1 AND 253 AND(original->>'pid')::integer>0 AND original->>'pidNamespace' ~ '^[0-9]+$' AND original->>'startTicks' ~ '^[0-9]+$';
EXCEPTION WHEN OTHERS THEN RETURN false;END $$;

-- Retain only original identity and source hashes after recoverable task material is removed.
CREATE TABLE task_runtime.work_origins(kind text NOT NULL,key text NOT NULL,id text NOT NULL,project_id text NOT NULL,revision text NOT NULL,identity text NOT NULL,PRIMARY KEY(kind,key));
CREATE FUNCTION task_runtime.work_granted(project text,grant_body jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$ BEGIN
 IF jsonb_typeof(grant_body) IS DISTINCT FROM 'object' OR NOT grant_body ?& ARRAY['operationId','generation','phase']
 OR grant_body-ARRAY['operationId','generation','phase']<>'{}'::jsonb OR jsonb_typeof(grant_body->'operationId') IS DISTINCT FROM 'string'
 OR jsonb_typeof(grant_body->'generation') IS DISTINCT FROM 'number' OR jsonb_typeof(grant_body->'phase') IS DISTINCT FROM 'string'
 OR grant_body->>'phase' NOT IN('stop','purge','prove','namespace','metadata','verify')
 OR current_setting('crewstation.task_runtime_work_grant',true) IS DISTINCT FROM task_runtime.work_digest(grant_body) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM task_runtime.project_admissions WHERE project_id=project AND operation_id=grant_body->>'operationId' AND generation=(grant_body->>'generation')::integer);
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION task_runtime.guard_work_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original jsonb;backend integer;sealing boolean;BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Runtime original identity cannot be rewritten or deleted';END IF;
 original:=jsonb_build_object('kind',NEW.kind,'key',NEW.key,'id',NEW.id,'projectId',NEW.project_id,'revision',NEW.revision);
 IF NEW.kind NOT IN('project','service','task','rebuild','parent-ending') OR NEW.key='' OR NEW.revision!~'^[a-f0-9]{64}$'
 OR NEW.id!~'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR NEW.project_id!~'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR NEW.identity IS DISTINCT FROM task_runtime.work_digest(original)
 OR current_setting('crewstation.task_runtime_origin',true) IS DISTINCT FROM task_runtime.work_digest(original||jsonb_build_object('identity',NEW.identity)) THEN
 RAISE EXCEPTION 'Runtime origin requires the original public source';END IF;
 BEGIN backend:=NULLIF(current_setting('crewstation.shared_admission_pid',true),'')::integer;EXCEPTION WHEN OTHERS THEN backend:=NULL;END;
 sealing:=task_runtime.work_locked(NEW.project_id,'ExclusiveLock',pg_backend_pid()) AND split_part(current_setting('crewstation.task_runtime_deletion_owner',true),':',3)='seal';
 IF NOT COALESCE(task_runtime.work_admitted(NEW.project_id,backend),false) AND NOT COALESCE(sealing,false) THEN RAISE EXCEPTION 'Runtime origin requires actual admitted original work';END IF;
 IF EXISTS(SELECT 1 FROM task_runtime.project_admissions WHERE project_id=NEW.project_id) AND NOT COALESCE(sealing AND EXISTS(SELECT 1 FROM task_runtime.project_admissions a
 WHERE a.project_id=NEW.project_id AND current_setting('crewstation.task_runtime_deletion_owner',true)=a.operation_id||':'||a.generation||':seal'),false) THEN
 RAISE EXCEPTION 'Runtime origin admission is permanently sealed';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER runtime_work_origin_guard BEFORE INSERT OR UPDATE OR DELETE ON task_runtime.work_origins FOR EACH ROW EXECUTE FUNCTION task_runtime.guard_work_origin();

CREATE FUNCTION task_runtime.guard_work_callbacks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_body jsonb;after_body jsonb;private_key text:=current_setting('crewstation.task_runtime_callback_exit',true);BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original runtime callbacks require a completed metadata owner';END IF;
 after_body:=to_jsonb(NEW);
 IF TG_OP='INSERT' THEN
  IF task_runtime.work_birth_valid(after_body) IS DISTINCT FROM true OR NEW.kind NOT IN('project-api','service-api','task-api','native-job','rebuild-job','parent-ending','reconcile','observe-startup','archive','ledger-resync','parent-recovery','deletion','effect') OR NEW.exited_at IS NOT NULL OR NEW.exit_digest IS NOT NULL OR NEW.recovery_digest IS NOT NULL
    OR NOT task_runtime.work_admitted(NEW.project_id,NEW.backend_pid) THEN RAISE EXCEPTION 'Runtime callback requires actual admitted original birth';END IF;
  IF NOT EXISTS(SELECT 1 FROM task_runtime.work_origins WHERE kind=NEW.origin_kind AND key=NEW.origin_key AND id=NEW.origin_id AND project_id=NEW.project_id AND revision=NEW.origin_revision) THEN RAISE EXCEPTION 'Runtime callback requires its original immutable source';END IF;
  IF NEW.deletion_grant IS NULL THEN
   IF NEW.kind='deletion' OR EXISTS(SELECT 1 FROM task_runtime.project_admissions WHERE project_id=NEW.project_id) THEN RAISE EXCEPTION 'Runtime admission is permanently sealed';END IF;
  ELSE
   IF NOT task_runtime.work_granted(NEW.project_id,NEW.deletion_grant) OR NEW.kind NOT IN('deletion','effect') THEN RAISE EXCEPTION 'Runtime cleanup requires the current original deletion phase';END IF;
  END IF;
  RETURN NEW;
 END IF;
 before_body:=to_jsonb(OLD);
 IF before_body-ARRAY['exited_at','exit_digest','recovery_digest'] IS DISTINCT FROM after_body-ARRAY['exited_at','exit_digest','recovery_digest'] OR OLD.exited_at IS NOT NULL OR NEW.exited_at IS NULL
   OR NEW.exit_digest IS DISTINCT FROM task_runtime.work_identity(before_body,NEW.recovery_digest) THEN RAISE EXCEPTION 'Original runtime callback identity is immutable';END IF;
 IF NEW.recovery_digest IS NULL THEN
  IF private_key IS NULL OR task_runtime.work_digest(to_jsonb(private_key)) IS DISTINCT FROM OLD.exit_key_hash THEN RAISE EXCEPTION 'Runtime exit requires the private original finally';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM task_runtime.callback_pod_stops WHERE identity=current_setting('crewstation.task_runtime_pod_recovery',true)
   AND digest=NEW.recovery_digest AND original_process=OLD.original_process-ARRAY['containerId','pid','pidNamespace','bootId','startTicks']) THEN RAISE EXCEPTION 'Runtime recovery requires original whole Pod stop proof';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION task_runtime.guard_work_admissions() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR NEW.revision!~'^[a-f0-9]{64}$' OR NOT task_runtime.work_locked(NEW.project_id,'ExclusiveLock',pg_backend_pid())
  OR current_setting('crewstation.task_runtime_deletion_owner',true) IS DISTINCT FROM NEW.operation_id||':'||NEW.generation||':seal' THEN RAISE EXCEPTION 'Runtime closure requires original exclusive deletion grant';END IF;
 IF TG_OP='UPDATE' AND(NEW.project_id<>OLD.project_id OR NEW.operation_id<>OLD.operation_id OR NEW.generation<=OLD.generation) THEN RAISE EXCEPTION 'Runtime original operation and generation cannot be replaced';END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION task_runtime.guard_work_pod_stops() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP<>'INSERT' OR NEW.identity IS DISTINCT FROM task_runtime.work_digest(NEW.original_process) OR NEW.digest!~'^[a-f0-9]{64}$'
  OR current_setting('crewstation.task_runtime_pod_stop',true) IS DISTINCT FROM task_runtime.work_digest(jsonb_build_object('process',NEW.original_process,'digest',NEW.digest))
  OR NEW.original_process-ARRAY['podUid','nodeUid','nodeName']<>'{}'::jsonb OR NOT NEW.original_process ?& ARRAY['podUid','nodeUid','nodeName'] THEN RAISE EXCEPTION 'Runtime original Pod stop requires independent observer';END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION task_runtime.reject_work_truncate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Original runtime work cannot be truncated';END $$;
CREATE TRIGGER runtime_work_callback_guard BEFORE INSERT OR UPDATE OR DELETE ON task_runtime.original_callbacks FOR EACH ROW EXECUTE FUNCTION task_runtime.guard_work_callbacks();
CREATE TRIGGER runtime_work_admission_guard BEFORE INSERT OR UPDATE OR DELETE ON task_runtime.project_admissions FOR EACH ROW EXECUTE FUNCTION task_runtime.guard_work_admissions();
CREATE TRIGGER runtime_work_pod_stop_guard BEFORE INSERT OR UPDATE OR DELETE ON task_runtime.callback_pod_stops FOR EACH ROW EXECUTE FUNCTION task_runtime.guard_work_pod_stops();
CREATE TRIGGER runtime_work_callback_truncate BEFORE TRUNCATE ON task_runtime.original_callbacks FOR EACH STATEMENT EXECUTE FUNCTION task_runtime.reject_work_truncate();
CREATE TRIGGER runtime_work_admission_truncate BEFORE TRUNCATE ON task_runtime.project_admissions FOR EACH STATEMENT EXECUTE FUNCTION task_runtime.reject_work_truncate();
CREATE TRIGGER runtime_work_pod_stop_truncate BEFORE TRUNCATE ON task_runtime.callback_pod_stops FOR EACH STATEMENT EXECUTE FUNCTION task_runtime.reject_work_truncate();

CREATE TRIGGER runtime_work_origin_truncate BEFORE TRUNCATE ON task_runtime.work_origins FOR EACH STATEMENT EXECUTE FUNCTION task_runtime.reject_work_truncate();
