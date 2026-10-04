-- RFC-037: keep the completed metadata path and project-root identity check on explicitly granted callbacks. The prior locked migration remains unchanged.
CREATE OR REPLACE FUNCTION dev_session.guard_work_callbacks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_body jsonb;after_body jsonb;private_key text:=current_setting('crewstation.dev_session_callback_exit',true);BEGIN
 IF TG_OP='DELETE' THEN IF OLD.exited_at IS NULL OR NOT dev_session.metadata_permitted(OLD.project_id) THEN RAISE EXCEPTION 'Original development callbacks require a completed metadata owner';END IF;RETURN OLD;END IF;
 after_body:=to_jsonb(NEW);
 IF TG_OP='INSERT' THEN
  IF dev_session.work_birth_valid(after_body) IS DISTINCT FROM true OR NEW.kind NOT IN('project-api','task-api','agent-dispatch','native-dispatch','reminder','usage','ending','deletion','effect') OR NEW.exited_at IS NOT NULL OR NEW.exit_digest IS NOT NULL OR NEW.recovery_digest IS NOT NULL
    OR NOT dev_session.work_admitted(NEW.project_id,NEW.backend_pid) THEN RAISE EXCEPTION 'Development callback requires actual admitted original birth';END IF;
  IF NOT EXISTS(SELECT 1 FROM dev_session.content_origins WHERE kind=NEW.origin_kind AND key=NEW.origin_key AND id=NEW.origin_id AND project_id=NEW.project_id) OR(NEW.origin_kind='project' AND NEW.origin_id<>NEW.project_id) THEN RAISE EXCEPTION 'Development cleanup requires its original source';END IF;
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
