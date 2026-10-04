-- Original command callbacks hold actual shared admission through wire I/O and durable persistence.
CREATE TABLE session.original_callbacks(
 id text PRIMARY KEY,project_id text,task_key text NOT NULL,task_id text NOT NULL,origin_revision text NOT NULL,
 kind text NOT NULL,reference text NOT NULL,input_digest text NOT NULL,backend_pid integer NOT NULL,
 original_process jsonb,deletion_grant jsonb,exit_key_hash text NOT NULL,identity text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),exited_at timestamptz,exit_digest text,recovery_digest text,
 CHECK((exited_at IS NULL)=(exit_digest IS NULL))
);
CREATE INDEX session_original_callbacks_project ON session.original_callbacks(project_id,id);
CREATE INDEX session_original_callbacks_task ON session.original_callbacks(task_key,id);
CREATE FUNCTION session.work_identity(body jsonb,recovery text DEFAULT NULL) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT session.digest(jsonb_build_object('id',body->'id','projectId',body->'project_id','taskKey',body->'task_key',
 'taskId',body->'task_id','originRevision',body->'origin_revision','kind',body->'kind','reference',body->'reference',
 'inputDigest',body->'input_digest','backendPid',body->'backend_pid','process',body->'original_process',
 'grant',body->'deletion_grant','exitKeyDigest',body->'exit_key_hash')
 ||CASE WHEN recovery IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('recoveryDigest',recovery) END)
$$;
CREATE FUNCTION session.work_admitted(project text,backend integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT backend::text=current_setting('crewstation.shared_admission_pid',true)
 AND session.locked(CASE WHEN project IS NULL THEN 'session.platform-admission' ELSE 'session.project-admission:'||project END,'ShareLock',backend)
$$;
CREATE FUNCTION session.work_granted(project text,grant_body jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$ BEGIN
 IF project IS NULL OR jsonb_typeof(grant_body) IS DISTINCT FROM 'object'
 OR NOT grant_body ?& ARRAY['operationId','generation','phase','revision']
 OR grant_body-ARRAY['operationId','generation','phase','revision']<>'{}'::jsonb
 OR jsonb_typeof(grant_body->'generation') IS DISTINCT FROM 'number' OR grant_body->>'phase' IS DISTINCT FROM 'stop'
 OR current_setting('crewstation.session_work_grant',true) IS DISTINCT FROM session.digest(grant_body) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM session.project_deletions d WHERE d.project_id=project AND d.verified
 AND d.operation_id=grant_body->>'operationId' AND d.generation=(grant_body->>'generation')::integer
 AND d.revision=grant_body->>'revision' AND d.phases ? 'seal' AND NOT d.phases ? 'stop');
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION session.guard_work_callback() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_body jsonb;after_body jsonb;pod jsonb;BEGIN
 IF TG_OP='INSERT' THEN
  after_body:=to_jsonb(NEW);
  IF NEW.id!~'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   OR NEW.kind NOT IN('command','cleanup') OR NEW.input_digest!~'^[a-f0-9]{64}$' OR NEW.exit_key_hash!~'^[a-f0-9]{64}$'
   OR NEW.identity IS DISTINCT FROM session.work_identity(after_body)
   OR current_setting('crewstation.session_work_birth',true) IS DISTINCT FROM NEW.identity
   OR NEW.exited_at IS NOT NULL OR NEW.exit_digest IS NOT NULL OR NEW.recovery_digest IS NOT NULL
   OR NOT COALESCE(session.work_admitted(NEW.project_id,NEW.backend_pid),false)
   OR NOT EXISTS(SELECT 1 FROM session.task_origins o WHERE o.task_key=NEW.task_key AND o.task_id=NEW.task_id
    AND o.project_id IS NOT DISTINCT FROM NEW.project_id AND o.identity=NEW.origin_revision) THEN
   RAISE EXCEPTION 'Session work requires its actual admitted original birth';END IF;
  IF NEW.deletion_grant IS NULL THEN
   IF NEW.kind<>'command' OR EXISTS(SELECT 1 FROM session.project_deletions WHERE project_id=NEW.project_id) THEN
    RAISE EXCEPTION 'Session normal command admission is closed';END IF;
  ELSIF NEW.kind<>'cleanup' OR NEW.original_process IS NULL OR NOT session.work_granted(NEW.project_id,NEW.deletion_grant)
   OR NOT EXISTS(SELECT 1 FROM session.project_deletions WHERE project_id=NEW.project_id
    AND body->'taskKeys' @> jsonb_build_array(NEW.task_key)) THEN
   RAISE EXCEPTION 'Session cleanup requires the current original stop scope';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' THEN
  before_body:=to_jsonb(OLD);after_body:=to_jsonb(NEW);
  IF before_body-ARRAY['exited_at','exit_digest','recovery_digest'] IS DISTINCT FROM after_body-ARRAY['exited_at','exit_digest','recovery_digest']
   OR OLD.exited_at IS NOT NULL OR NEW.exited_at IS NULL
   OR NEW.exit_digest IS DISTINCT FROM session.work_identity(before_body,NEW.recovery_digest) THEN
   RAISE EXCEPTION 'Session original work identity cannot be replaced';END IF;
  IF NEW.recovery_digest IS NULL THEN
   IF session.digest(to_jsonb(current_setting('crewstation.session_work_exit',true))) IS DISTINCT FROM OLD.exit_key_hash THEN
    RAISE EXCEPTION 'Session work exit requires its private actual finally';END IF;
  ELSE
   pod:=jsonb_build_object('podUid',OLD.original_process->>'podUid','nodeUid',OLD.original_process->>'nodeUid','nodeName',OLD.original_process->>'nodeName');
   IF OLD.original_process IS NULL OR current_setting('crewstation.session_pod_stop',true) IS DISTINCT FROM session.digest(pod)
    OR NOT EXISTS(SELECT 1 FROM session.process_stops WHERE identity=session.digest(pod) AND original_process=pod AND digest=NEW.recovery_digest) THEN
    RAISE EXCEPTION 'Session work recovery requires the whole original protected Pod stop';END IF;
  END IF;RETURN NEW;
 END IF;
 IF OLD.exited_at IS NULL OR NOT EXISTS(SELECT 1 FROM session.project_deletions d WHERE d.project_id=OLD.project_id
  AND d.verified AND d.phases ? 'namespace' AND current_setting('crewstation.session_deletion',true)=d.operation_id||':'||d.generation||':metadata'
  AND session.locked('session.project-admission:'||d.project_id,'ExclusiveLock',pg_backend_pid())) THEN
  RAISE EXCEPTION 'Session work requires its completed metadata owner';END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER session_original_work_guard BEFORE INSERT OR UPDATE OR DELETE ON session.original_callbacks FOR EACH ROW EXECUTE FUNCTION session.guard_work_callback();
CREATE TRIGGER session_original_work_truncate BEFORE TRUNCATE ON session.original_callbacks FOR EACH STATEMENT EXECUTE FUNCTION session.reject_truncate();
CREATE FUNCTION session.stop_write_permitted(task text,backend integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM session.original_callbacks c JOIN session.project_deletions d ON d.project_id=c.project_id
 WHERE c.task_key=task AND c.backend_pid=backend AND c.exited_at IS NULL AND c.kind='cleanup'
 AND c.id=current_setting('crewstation.session_work_callback',true)
 AND c.exit_key_hash=session.digest(to_jsonb(current_setting('crewstation.session_work_key',true)))
 AND COALESCE(session.work_admitted(c.project_id,backend),false) AND d.verified AND d.phases ? 'seal' AND NOT d.phases ? 'stop'
 AND c.deletion_grant->>'operationId'=d.operation_id AND(c.deletion_grant->>'generation')::integer=d.generation
 AND c.deletion_grant->>'revision'=d.revision AND c.deletion_grant->>'phase'='stop'
 AND session.work_granted(c.project_id,c.deletion_grant))
$$;
CREATE OR REPLACE FUNCTION session.guard_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task text;project text;scope session.project_deletions%ROWTYPE;key text;backend integer;before_body jsonb;after_body jsonb;BEGIN
 task:=CASE WHEN TG_OP='DELETE' THEN OLD.task_id ELSE NEW.task_id END;
 IF TG_OP='UPDATE' AND OLD.task_id<>NEW.task_id THEN RAISE EXCEPTION 'Session original task identity cannot be replaced';END IF;
 SELECT project_id INTO project FROM session.task_origins WHERE task_key=task;key:=session.admission_key(task);
 BEGIN backend:=NULLIF(current_setting('crewstation.shared_admission_pid',true),'')::integer;EXCEPTION WHEN OTHERS THEN backend:=NULL;END;
 IF key IS NOT NULL AND NOT COALESCE(session.work_admitted(project,backend),false) AND NOT session.locked(key,'ExclusiveLock',pg_backend_pid()) THEN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended(key,0));END IF;
 SELECT * INTO scope FROM session.project_deletions WHERE project_id=project;
 IF NOT FOUND THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 IF TG_TABLE_NAME='connections' THEN
  IF TG_OP='UPDATE' AND to_jsonb(NEW)-'last_seen_at'=to_jsonb(OLD)-'last_seen_at' THEN RETURN NEW;END IF;
  IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM session.connection_births WHERE id=OLD.consumer_id AND exited_at IS NOT NULL) THEN RETURN OLD;END IF;
 END IF;
 IF TG_OP='DELETE' AND scope.verified AND scope.phases ? 'namespace'
  AND current_setting('crewstation.session_deletion',true)=scope.operation_id||':'||scope.generation||':metadata'
  AND session.locked(key,'ExclusiveLock',pg_backend_pid())
  AND NOT EXISTS(SELECT 1 FROM session.original_callbacks WHERE project_id=project AND exited_at IS NULL) THEN RETURN OLD;END IF;
 IF NOT COALESCE(session.stop_write_permitted(task,backend),false) OR TG_OP='DELETE'
  OR TG_TABLE_NAME NOT IN('business_executions','business_execution_events','business_usage_sources','business_usage_events',
   'business_stopped_executions','execution_completion_proofs','development_usage_streams','development_usage_events') THEN
  RAISE EXCEPTION 'Session project admission is closed';END IF;
 IF TG_OP='UPDATE' THEN
  before_body:=to_jsonb(OLD);after_body:=to_jsonb(NEW);
  IF TG_TABLE_NAME IN('business_execution_events','business_usage_events','development_usage_events','business_stopped_executions','execution_completion_proofs') THEN
   RAISE EXCEPTION 'Session original numeric evidence is immutable';END IF;
  IF TG_TABLE_NAME='development_usage_streams' AND before_body->'registration' IS DISTINCT FROM after_body->'registration' THEN
   RAISE EXCEPTION 'Session original development registration cannot be replaced';END IF;
  IF TG_TABLE_NAME='business_executions' AND(before_body->'execution_id' IS DISTINCT FROM after_body->'execution_id'
   OR before_body->'receipt'->'executionId' IS DISTINCT FROM after_body->'receipt'->'executionId'
   OR before_body->'receipt'->'attemptId' IS DISTINCT FROM after_body->'receipt'->'attemptId'
   OR before_body->'receipt'->'incarnationId' IS DISTINCT FROM after_body->'receipt'->'incarnationId'
   OR before_body->'receipt'->'payloadDigest' IS DISTINCT FROM after_body->'receipt'->'payloadDigest') THEN
   RAISE EXCEPTION 'Session original business execution cannot be replaced';END IF;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME IN('business_executions','development_usage_streams') THEN
  RAISE EXCEPTION 'Session cleanup cannot register a new numeric execution';END IF;
 RETURN NEW;
END $$;
-- Capture every table, including empty sets, using bounded parameters rather than one parameter per task.
CREATE FUNCTION session.stop_snapshot(project text,keys jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE name text;predicate text;body_expression text;row_count bigint;row_digest text;tables jsonb:='[]'::jsonb;total bigint:=0;BEGIN
 IF jsonb_typeof(keys) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Session snapshot requires complete original task keys';END IF;
 FOREACH name IN ARRAY ARRAY['runner_events','connections','business_execution_events','business_usage_events','business_usage_sources',
 'business_stopped_executions','execution_completion_proofs','business_executions','development_usage_events','development_usage_streams','connection_births','original_callbacks'] LOOP
  predicate:=CASE WHEN name='original_callbacks' THEN 'content.project_id=$1'
   WHEN name='connection_births' THEN 'content.task_key IN(SELECT jsonb_array_elements_text($2))'
   ELSE 'content.task_id IN(SELECT jsonb_array_elements_text($2))' END;
  body_expression:=CASE WHEN name='connections' THEN 'to_jsonb(content)-''last_seen_at''' ELSE 'to_jsonb(content)' END;
  EXECUTE format('SELECT count(*),session.digest(COALESCE(jsonb_agg(session.digest(%s) ORDER BY session.digest(%s)),''[]''::jsonb)) FROM session.%I content WHERE %s',
   body_expression,body_expression,name,predicate) INTO row_count,row_digest USING project,keys;
  tables:=tables||jsonb_build_array(jsonb_build_object('table',name,'count',row_count,'digest',row_digest));total:=total+row_count;
 END LOOP;
 RETURN jsonb_build_object('tables',tables,'count',total,'digest',session.digest(tables));
END $$;
CREATE OR REPLACE FUNCTION session.guard_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phase text;compacted jsonb;allowed_stop boolean:=false;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Session deletion tombstone cannot be removed';END IF;
 phase:=split_part(current_setting('crewstation.session_deletion',true),':',3);
 IF phase IS NULL OR phase NOT IN('seal','stop','purge','prove','namespace','metadata','verify')
  OR current_setting('crewstation.session_deletion',true) IS DISTINCT FROM NEW.operation_id||':'||NEW.generation||':'||phase
  OR NOT session.locked('session.project-admission:'||NEW.project_id,'ExclusiveLock',pg_backend_pid())
  OR NEW.generation<1 OR NEW.revision!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Session deletion requires the original exclusive grant';END IF;
 IF TG_OP='UPDATE' AND(NEW.project_id<>OLD.project_id OR NEW.operation_id<>OLD.operation_id OR NEW.generation<OLD.generation) THEN
  RAISE EXCEPTION 'Session deletion original operation cannot be replaced';END IF;
 IF TG_OP='UPDATE' AND NEW.revision=OLD.revision THEN
  IF OLD.verified AND NOT NEW.verified OR NOT NEW.phases @> OLD.phases THEN RAISE EXCEPTION 'Session original phase proof cannot be replaced';END IF;
  IF phase='stop' AND OLD.verified AND OLD.phases ? 'seal' AND NOT OLD.phases ? 'stop' AND NOT OLD.body ? 'stopped'
   AND NEW.phases ? 'stop' AND NOT EXISTS(SELECT 1 FROM session.original_callbacks WHERE project_id=OLD.project_id AND exited_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM session.connection_births WHERE task_key IN(SELECT jsonb_array_elements_text(OLD.body->'taskKeys')) AND exited_at IS NULL) THEN
   allowed_stop:=NEW.body=OLD.body||jsonb_build_object('stopped',session.stop_snapshot(OLD.project_id,OLD.body->'taskKeys'));
  END IF;
  compacted:=OLD.body||'{"taskKeys":[],"births":[],"compacted":true}'::jsonb;
  IF OLD.body ? 'callbacks' THEN compacted:=compacted||'{"callbacks":[]}'::jsonb;END IF;
  IF NEW.body IS DISTINCT FROM OLD.body AND NOT allowed_stop AND NOT(phase='metadata' AND OLD.phases ? 'namespace'
    AND OLD.body ? 'stopped' AND NEW.body=compacted) THEN RAISE EXCEPTION 'Session original scope cannot be replaced';END IF;
  IF NEW.phases ? 'stop' AND NOT OLD.phases ? 'stop' AND NOT allowed_stop THEN
   RAISE EXCEPTION 'Session stop requires its complete exited callbacks and atomic snapshot';END IF;
 ELSIF TG_OP='UPDATE' AND(NEW.generation<=OLD.generation OR phase<>'seal' OR NEW.phases<>'{}'::jsonb) THEN
  RAISE EXCEPTION 'Session renewed scope requires a later original seal';END IF;
 RETURN NEW;
END $$;
