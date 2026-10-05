-- Original byte callbacks remain durable after admission connection loss. Deadlines never prove exit.
CREATE TABLE data.object_work(id text PRIMARY KEY,project_id text NOT NULL,kind text NOT NULL,backend_pid integer NOT NULL,body jsonb NOT NULL,exit_key_hash text NOT NULL,state text NOT NULL DEFAULT 'running' CHECK(state IN('running','finished')),exit_digest text,recovery_digest text);
CREATE INDEX data_object_work_pending ON data.object_work(project_id,state);
CREATE FUNCTION data.object_work_admitted(project text,backend integer) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE keys jsonb;lock_key bigint:=hashtextextended('data.project-admission:'||project,0);BEGIN
 BEGIN keys:=NULLIF(current_setting('crewstation.shared_admission_keys',true),'')::jsonb;EXCEPTION WHEN OTHERS THEN RETURN false;END;
 IF backend::text IS DISTINCT FROM current_setting('crewstation.shared_admission_pid',true) OR keys IS NULL OR NOT keys ? ('data.project-admission:'||project) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=backend AND granted AND mode='ShareLock'
 AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid=((lock_key>>32)&4294967295)::oid AND objid=(lock_key&4294967295)::oid AND objsubid=1);
END $$;
CREATE FUNCTION data.object_work_birth_valid(snapshot jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE origin jsonb:=snapshot->'body';process jsonb:=origin->'process';resource_pattern text:='^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$';uuid_pattern text:='^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$';BEGIN
 RETURN snapshot->>'id' ~ resource_pattern AND snapshot->>'project_id' ~ resource_pattern AND snapshot->>'kind' IN('put','get','verify','remove','inspect')
 AND snapshot->>'exit_key_hash' ~ '^[a-f0-9]{64}$' AND (snapshot->>'backend_pid')::integer>0
 AND origin->>'projectId'=snapshot->>'project_id' AND origin->>'serviceId' ~ resource_pattern AND origin->>'spaceId' ~ resource_pattern AND origin->>'attemptId' ~ resource_pattern AND origin->>'backendId' ~ resource_pattern
 AND origin->>'key'='spaces/'||(origin->>'spaceId')||'/attempts/'||(origin->>'attemptId') AND (origin->>'placementRevision')::integer>0 AND (origin->>'size')::bigint BETWEEN 0 AND 9007199254740991
 AND process->>'podUid' ~ uuid_pattern AND process->>'nodeUid' ~ uuid_pattern AND process->>'bootId' ~ uuid_pattern
 AND process->>'containerId' ~ '^[a-z0-9]+://[a-f0-9]{64}$' AND length(process->>'nodeName') BETWEEN 1 AND 253 AND (process->>'pid')::integer>0 AND process->>'startTicks' ~ '^[0-9]+$' AND process->>'pidNamespace' ~ '^[0-9]+$';
EXCEPTION WHEN OTHERS THEN RETURN false;END $$;
CREATE FUNCTION data.guard_object_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scope data.project_deletions%ROWTYPE;exit_key text:=current_setting('crewstation.data_object_work_exit',true);recovery jsonb;BEGIN
 IF TG_OP='INSERT' THEN
  IF data.object_work_birth_valid(to_jsonb(NEW)) IS DISTINCT FROM true OR NEW.state<>'running' OR NEW.exit_digest IS NOT NULL OR NEW.recovery_digest IS NOT NULL OR NOT data.object_work_admitted(NEW.project_id,NEW.backend_pid) THEN RAISE EXCEPTION 'object request requires its original admitted birth' USING ERRCODE='55000';END IF;
  IF EXISTS(SELECT 1 FROM data.project_deletions WHERE project_id=NEW.project_id) THEN RAISE EXCEPTION 'object request project is sealed' USING ERRCODE='55000';END IF;
  IF NOT EXISTS(SELECT 1 FROM data.object_upload_attempts a INNER JOIN data.object_spaces s ON s.id=a.space_id INNER JOIN data.object_uploads u ON u.id=a.upload_id AND u.space_id=a.space_id WHERE a.id=NEW.body->>'attemptId' AND s.id=NEW.body->>'spaceId' AND s.project_id=NEW.project_id AND s.service_id=NEW.body->>'serviceId' AND a.backend_id=NEW.body->>'backendId' AND a.body->>'key'=NEW.body->>'key' AND a.body->>'size'=NEW.body->>'size' AND a.body->>'placementRevision'=NEW.body->>'placementRevision') THEN RAISE EXCEPTION 'object request original location differs' USING ERRCODE='55000';END IF;
  IF EXISTS(SELECT 1 FROM data.content_origins WHERE kind='object-work' AND key=NEW.id) THEN RAISE EXCEPTION 'original object request cannot be recreated' USING ERRCODE='55000';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
  SELECT * INTO scope FROM data.project_deletions WHERE project_id=OLD.project_id;
  IF OLD.state<>'finished' OR OLD.exit_digest IS DISTINCT FROM encode(sha256(convert_to(OLD.body::text,'UTF8')),'hex') OR NOT coalesce(scope.verified AND scope.phases ? 'namespace' AND data.deletion_locked(OLD.project_id) AND current_setting('crewstation.data_deletion',true)=scope.operation_id||':'||scope.generation||':metadata',false) THEN RAISE EXCEPTION 'object request removal requires original exit and metadata owner' USING ERRCODE='55000';END IF;
  RETURN OLD;
 END IF;
 IF to_jsonb(NEW)-ARRAY['state','exit_digest','recovery_digest'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','exit_digest','recovery_digest'] OR OLD.state<>'running' OR NEW.state<>'finished' OR NEW.exit_digest IS DISTINCT FROM encode(sha256(convert_to(OLD.body::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'object request original birth and exit are immutable' USING ERRCODE='55000';END IF;
 IF NEW.recovery_digest IS NULL THEN
  IF exit_key IS NULL OR encode(sha256(convert_to(exit_key,'UTF8')),'hex') IS DISTINCT FROM OLD.exit_key_hash THEN RAISE EXCEPTION 'object request exit requires original private key' USING ERRCODE='55000';END IF;
 ELSE
  BEGIN recovery:=NULLIF(current_setting('crewstation.data_object_work_recovery',true),'')::jsonb;EXCEPTION WHEN OTHERS THEN recovery:=NULL;END;
  IF recovery IS NULL OR NEW.recovery_digest!~'^[a-f0-9]{64}$' OR recovery->>'digest' IS DISTINCT FROM NEW.recovery_digest OR recovery->>'podUid' IS DISTINCT FROM OLD.body->'process'->>'podUid' OR recovery->>'nodeUid' IS DISTINCT FROM OLD.body->'process'->>'nodeUid' OR recovery->>'nodeName' IS DISTINCT FROM OLD.body->'process'->>'nodeName' THEN RAISE EXCEPTION 'object request recovery requires original full Pod stop' USING ERRCODE='55000';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER data_object_request_guard BEFORE INSERT OR UPDATE OR DELETE ON data.object_work FOR EACH ROW EXECUTE FUNCTION data.guard_object_work();
CREATE TRIGGER data_object_request_truncate BEFORE TRUNCATE ON data.object_work FOR EACH STATEMENT EXECUTE FUNCTION data.reject_truncate();
