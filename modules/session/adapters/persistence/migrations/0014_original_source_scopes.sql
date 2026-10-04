-- Extend the locked original-work migration with task-scoped writes and immutable numeric sources.
CREATE OR REPLACE FUNCTION session.guard_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task text;project text;scope session.project_deletions%ROWTYPE;key text;backend integer;before_body jsonb;after_body jsonb;BEGIN
 task:=CASE WHEN TG_OP='DELETE' THEN OLD.task_id ELSE NEW.task_id END;
 IF TG_OP='UPDATE' AND OLD.task_id<>NEW.task_id THEN RAISE EXCEPTION 'Session original task identity cannot be replaced';END IF;
 SELECT project_id INTO project FROM session.task_origins WHERE task_key=task;key:=session.admission_key(task);
 BEGIN backend:=NULLIF(current_setting('crewstation.shared_admission_pid',true),'')::integer;EXCEPTION WHEN OTHERS THEN backend:=NULL;END;
 IF NULLIF(current_setting('crewstation.session_work_callback',true),'') IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM session.original_callbacks c WHERE c.id=current_setting('crewstation.session_work_callback',true)
  AND c.task_key=task AND c.backend_pid=backend AND c.exited_at IS NULL
  AND c.exit_key_hash=session.digest(to_jsonb(current_setting('crewstation.session_work_key',true)))
  AND COALESCE(session.work_admitted(c.project_id,backend),false)) THEN
  RAISE EXCEPTION 'Session original callback cannot expand to another task';END IF;
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
  IF TG_TABLE_NAME='business_usage_sources' AND(before_body->'execution_id' IS DISTINCT FROM after_body->'execution_id'
   OR before_body->'attempt' IS DISTINCT FROM after_body->'attempt' OR before_body->'incarnation' IS DISTINCT FROM after_body->'incarnation'
   OR before_body->'payload_digest' IS DISTINCT FROM after_body->'payload_digest') THEN
   RAISE EXCEPTION 'Session original business usage source cannot be replaced';END IF;
  IF TG_TABLE_NAME='business_executions' AND(before_body->'execution_id' IS DISTINCT FROM after_body->'execution_id'
   OR before_body->'receipt'->'executionId' IS DISTINCT FROM after_body->'receipt'->'executionId'
   OR before_body->'receipt'->'attemptId' IS DISTINCT FROM after_body->'receipt'->'attemptId'
   OR before_body->'receipt'->'incarnationId' IS DISTINCT FROM after_body->'receipt'->'incarnationId'
   OR before_body->'receipt'->'payloadDigest' IS DISTINCT FROM after_body->'receipt'->'payloadDigest') THEN
   RAISE EXCEPTION 'Session original business execution cannot be replaced';END IF;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME IN('business_executions','development_usage_streams') THEN
  RAISE EXCEPTION 'Session cleanup cannot register a new numeric execution';END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME='business_usage_sources' AND NOT EXISTS(SELECT 1 FROM session.business_executions execution
  WHERE execution.task_id=task AND execution.execution_id=to_jsonb(NEW)->>'execution_id'
  AND execution.receipt->>'attempt'=to_jsonb(NEW)->>'attempt' AND execution.receipt->>'incarnation'=to_jsonb(NEW)->>'incarnation'
  AND execution.receipt->>'payloadDigest'=to_jsonb(NEW)->>'payload_digest') THEN
  RAISE EXCEPTION 'Session usage source requires its original numeric execution';END IF;
 RETURN NEW;
END $$;
