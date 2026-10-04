-- RFC-037: explicitly granted original cleanup. Existing callbacks keep their original birth and exit hashes.
ALTER TABLE dev_session.original_callbacks ADD COLUMN deletion_grant jsonb;
CREATE OR REPLACE FUNCTION dev_session.work_identity(body jsonb,recovery text DEFAULT NULL) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT dev_session.work_digest(jsonb_build_object('id',body->'id','projectId',body->'project_id','originKind',body->'origin_kind','originKey',body->'origin_key','originId',body->'origin_id',
 'kind',body->'kind','reference',body->'reference','consumerId',body->'consumer_id','inputDigest',body->'input_digest',
 'originRevision',body->'origin_revision','backendPid',body->'backend_pid','process',body->'original_process','exitKeyDigest',body->'exit_key_hash')
 ||CASE WHEN body->'deletion_grant' IS NULL OR body->'deletion_grant'='null'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('grant',body->'deletion_grant') END
 ||CASE WHEN recovery IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('recoveryDigest',recovery) END)
$$;
CREATE OR REPLACE FUNCTION dev_session.work_granted(project text,grant_body jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$ BEGIN
 IF jsonb_typeof(grant_body) IS DISTINCT FROM 'object' OR NOT grant_body ?& ARRAY['operationId','generation','phase']
 OR grant_body-ARRAY['operationId','generation','phase']<>'{}'::jsonb OR jsonb_typeof(grant_body->'operationId') IS DISTINCT FROM 'string'
 OR jsonb_typeof(grant_body->'generation') IS DISTINCT FROM 'number' OR jsonb_typeof(grant_body->'phase') IS DISTINCT FROM 'string'
 OR grant_body->>'phase' NOT IN('stop','purge','prove','namespace','metadata','verify')
 OR current_setting('crewstation.dev_session_work_grant',true) IS DISTINCT FROM dev_session.work_digest(grant_body) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM dev_session.project_admissions WHERE project_id=project AND operation_id=grant_body->>'operationId' AND generation=(grant_body->>'generation')::integer);
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE OR REPLACE FUNCTION dev_session.guard_work_callbacks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_body jsonb;after_body jsonb;private_key text:=current_setting('crewstation.dev_session_callback_exit',true);BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original development callbacks require a completed metadata owner';END IF;
 after_body:=to_jsonb(NEW);
 IF TG_OP='INSERT' THEN
  IF dev_session.work_birth_valid(after_body) IS DISTINCT FROM true OR NEW.kind NOT IN('project-api','task-api','agent-dispatch','native-dispatch','reminder','usage','ending','deletion','effect') OR NEW.exited_at IS NOT NULL OR NEW.exit_digest IS NOT NULL OR NEW.recovery_digest IS NOT NULL
    OR NOT dev_session.work_admitted(NEW.project_id,NEW.backend_pid) THEN RAISE EXCEPTION 'Development callback requires actual admitted original birth';END IF;
  IF NOT EXISTS(SELECT 1 FROM dev_session.content_origins WHERE kind=NEW.origin_kind AND key=NEW.origin_key AND id=NEW.origin_id AND project_id=NEW.project_id) THEN RAISE EXCEPTION 'Development cleanup requires its original source';END IF;
  IF NEW.deletion_grant IS NULL THEN
   IF NEW.kind='deletion' OR EXISTS(SELECT 1 FROM dev_session.project_admissions WHERE project_id=NEW.project_id) THEN RAISE EXCEPTION 'Development admission is permanently sealed';END IF;
  ELSIF NOT dev_session.work_granted(NEW.project_id,NEW.deletion_grant) OR NEW.kind NOT IN('deletion','effect') THEN
   RAISE EXCEPTION 'Development cleanup requires the current original deletion phase';END IF;
  RETURN NEW;
 END IF;
 before_body:=to_jsonb(OLD);
 IF before_body-ARRAY['exited_at','exit_digest','recovery_digest'] IS DISTINCT FROM after_body-ARRAY['exited_at','exit_digest','recovery_digest'] OR OLD.exited_at IS NOT NULL OR NEW.exited_at IS NULL
   OR NEW.exit_digest IS DISTINCT FROM dev_session.work_identity(before_body,NEW.recovery_digest) THEN RAISE EXCEPTION 'Original development callback identity is immutable';END IF;
 IF NEW.recovery_digest IS NULL THEN
  IF private_key IS NULL OR dev_session.work_digest(to_jsonb(private_key)) IS DISTINCT FROM OLD.exit_key_hash THEN RAISE EXCEPTION 'Development exit requires the private original finally';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM dev_session.callback_pod_stops WHERE identity=current_setting('crewstation.dev_session_pod_recovery',true)
   AND digest=NEW.recovery_digest AND original_process=OLD.original_process-ARRAY['containerId','pid','pidNamespace','bootId','startTicks']) THEN RAISE EXCEPTION 'Development recovery requires original whole Pod stop proof';END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION dev_session.stop_write_permitted(project text,backend integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT dev_session.work_admitted(project,backend) AND EXISTS(SELECT 1 FROM dev_session.original_callbacks c JOIN dev_session.project_admissions a USING(project_id)
 WHERE c.project_id=project AND c.backend_pid=backend AND c.exited_at IS NULL AND c.deletion_grant->>'phase'='stop'
 AND c.deletion_grant->>'operationId'=a.operation_id AND(c.deletion_grant->>'generation')::integer=a.generation)
$$;
CREATE OR REPLACE FUNCTION dev_session.metadata_permitted(project text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM dev_session.project_deletions d JOIN dev_session.project_admissions a USING(project_id)
 WHERE d.project_id=project AND d.verified AND d.phases ? 'namespace' AND a.operation_id=d.operation_id AND a.generation=d.generation
 AND current_setting('crewstation.dev_session_deletion',true)=d.operation_id||':'||d.generation||':metadata'
 AND dev_session.work_locked(project,'ExclusiveLock',pg_backend_pid()))
 AND NOT EXISTS(SELECT 1 FROM dev_session.original_callbacks WHERE project_id=project AND exited_at IS NULL)
$$;

CREATE OR REPLACE FUNCTION dev_session.guard_all_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE body jsonb;links jsonb;previous jsonb;projects text[]:=ARRAY[]::text[];original text;field text;backend integer;BEGIN
 body:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;links:=dev_session.content_links(TG_TABLE_NAME,body);
 IF TG_OP='UPDATE' THEN previous:=dev_session.content_links(TG_TABLE_NAME,to_jsonb(OLD));
 IF previous IS DISTINCT FROM links THEN RAISE EXCEPTION 'Development original parent and project links cannot be replaced';END IF;END IF;
 IF NULLIF(links->>'project','') IS NOT NULL THEN projects:=array_append(projects,links->>'project');END IF;
 IF NOT EXISTS(SELECT 1 FROM dev_session.content_origins WHERE(kind='task' AND key IN(links->>'workspace',links->>'runtime',links->>'previous'))
 OR(kind='cluster-operation' AND key=links->>'operation')) AND cardinality(projects)=0 THEN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('dev-session.content-origins',0));END IF;
 FOREACH field IN ARRAY ARRAY['workspace','runtime','previous','operation'] LOOP
 IF NULLIF(links->>field,'') IS NULL THEN CONTINUE;END IF;
 SELECT project_id INTO original FROM dev_session.content_origins WHERE kind=CASE WHEN field='operation' THEN 'cluster-operation' ELSE 'task' END AND key=links->>field;
 IF original IS NOT NULL THEN projects:=array_append(projects,original);END IF;END LOOP;
 IF (SELECT count(DISTINCT item) FROM unnest(projects) item)>1 THEN RAISE EXCEPTION 'Development original content project links conflict';END IF;
 BEGIN backend:=NULLIF(current_setting('crewstation.shared_admission_pid',true),'')::integer;EXCEPTION WHEN OTHERS THEN backend:=NULL;END;
 FOREACH original IN ARRAY projects LOOP
 IF NOT COALESCE(dev_session.work_admitted(original,backend),false) AND NOT dev_session.work_locked(original,'ExclusiveLock',pg_backend_pid()) THEN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('dev-session.project-admission:'||original,0));END IF;
 IF EXISTS(SELECT 1 FROM dev_session.project_admissions WHERE project_id=original) AND NOT(TG_OP='DELETE' AND dev_session.metadata_permitted(original))
 AND NOT(COALESCE(dev_session.stop_write_permitted(original,backend),false) AND(TG_OP='UPDATE' OR TG_OP='INSERT' AND TG_TABLE_NAME='development_agent_endings')) THEN
 RAISE EXCEPTION 'Development project content admission is permanently sealed';END IF;END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
CREATE OR REPLACE FUNCTION dev_session.guard_content_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phase text;stopped jsonb;stop_snapshot boolean;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Development deletion tombstone cannot be removed';END IF;
 phase:=split_part(current_setting('crewstation.dev_session_deletion',true),':',3);
 IF phase IS NULL OR phase NOT IN('seal','stop','purge','prove','namespace','metadata','verify') OR NEW.generation<1 OR NEW.revision!~'^[a-f0-9]{64}$'
 OR current_setting('crewstation.dev_session_deletion',true) IS DISTINCT FROM NEW.operation_id||':'||NEW.generation||':'||phase
 OR NOT dev_session.work_locked(NEW.project_id,'ExclusiveLock',pg_backend_pid())
 OR NOT EXISTS(SELECT 1 FROM dev_session.project_admissions a WHERE a.project_id=NEW.project_id AND a.operation_id=NEW.operation_id AND a.generation=NEW.generation)
 THEN RAISE EXCEPTION 'Development deletion requires its original exclusive grant';END IF;
 IF TG_OP='UPDATE' AND(NEW.project_id<>OLD.project_id OR NEW.operation_id<>OLD.operation_id OR NEW.generation<OLD.generation) THEN RAISE EXCEPTION 'Development original deletion cannot be replaced';END IF;
 IF TG_OP='UPDATE' AND NEW.revision=OLD.revision THEN
 IF OLD.verified AND NOT NEW.verified OR NOT NEW.phases @> OLD.phases THEN RAISE EXCEPTION 'Development original phase proof cannot be replaced';END IF;
 stopped:=NEW.body->'stopped';
 stop_snapshot:=phase='stop' AND COALESCE(OLD.body->'stopped','null'::jsonb)='null'::jsonb AND OLD.body->>'compacted'='false'
 AND jsonb_typeof(stopped)='object' AND stopped ?& ARRAY['contents','callbacks','count','digest'] AND stopped-ARRAY['contents','callbacks','count','digest']='{}'::jsonb
 AND jsonb_typeof(stopped->'contents')='array' AND jsonb_typeof(stopped->'callbacks')='array'
 AND stopped->'count'=to_jsonb(jsonb_array_length(stopped->'contents')) AND stopped->>'digest'=dev_session.work_digest(jsonb_build_object('contents',stopped->'contents','callbacks',stopped->'callbacks'))
 AND NEW.body=OLD.body||jsonb_build_object('stopped',stopped) AND NOT EXISTS(SELECT 1 FROM dev_session.original_callbacks WHERE project_id=NEW.project_id AND exited_at IS NULL);
 IF NEW.body IS DISTINCT FROM OLD.body AND NOT COALESCE(stop_snapshot,false)
 AND NOT(phase='metadata' AND OLD.phases ? 'namespace' AND NEW.body=OLD.body||'{"contents":[],"callbacks":[],"stopped":null,"compacted":true}'::jsonb) THEN
 RAISE EXCEPTION 'Development frozen original content cannot be replaced';END IF;
 ELSIF TG_OP='UPDATE' AND(NEW.generation<=OLD.generation OR phase<>'seal' OR NEW.phases<>'{}'::jsonb) THEN RAISE EXCEPTION 'Development renewed inventory requires a later seal';END IF;RETURN NEW;
END $$;
