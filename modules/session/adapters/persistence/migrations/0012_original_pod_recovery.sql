ALTER TABLE session.connection_births ADD COLUMN original_process jsonb,ADD COLUMN recovery_digest text;
CREATE TABLE session.process_stops(identity text PRIMARY KEY,original_process jsonb NOT NULL,digest text NOT NULL);
CREATE FUNCTION session.guard_process_stop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP<>'INSERT' OR NEW.identity IS DISTINCT FROM session.digest(NEW.original_process) OR NEW.digest!~'^[a-f0-9]{64}$'
 OR current_setting('crewstation.session_pod_stop',true) IS DISTINCT FROM NEW.identity THEN RAISE EXCEPTION 'Session stop requires the original protected Pod observer';END IF;RETURN NEW;
END $$;
CREATE TRIGGER session_process_stop_guard BEFORE INSERT OR UPDATE OR DELETE ON session.process_stops FOR EACH ROW EXECUTE FUNCTION session.guard_process_stop();
CREATE TRIGGER session_process_stop_truncate BEFORE TRUNCATE ON session.process_stops FOR EACH STATEMENT EXECUTE FUNCTION session.reject_truncate();
CREATE OR REPLACE FUNCTION session.guard_birth() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE project text;scope session.project_deletions%ROWTYPE;key text;material jsonb;pod jsonb;BEGIN
 IF TG_OP='INSERT' THEN
  key:=session.admission_key(NEW.task_key);
  material:=jsonb_build_object('id',NEW.id,'taskId',NEW.task_key,'replica',NEW.replica,'at',to_char(NEW.connected_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'exitKeyHash',NEW.exit_key_hash);
  IF NEW.original_process IS NOT NULL THEN material:=material||jsonb_build_object('process',NEW.original_process);END IF;
  IF key IS NULL OR NEW.backend_pid::text IS DISTINCT FROM current_setting('crewstation.shared_admission_pid',true)
   OR NOT session.locked(key,'ShareLock',NEW.backend_pid) OR NEW.recovery_digest IS NOT NULL OR NEW.exited_at IS NOT NULL OR NEW.exit_digest IS NOT NULL
   OR NEW.exit_key_hash!~'^[a-f0-9]{64}$' OR NEW.identity IS DISTINCT FROM session.digest(material)
   OR NOT EXISTS(SELECT 1 FROM session.connections WHERE task_id=NEW.task_key AND consumer_id=NEW.id AND replica=NEW.replica AND connected_at=NEW.connected_at) THEN
   RAISE EXCEPTION 'Session birth requires the original admitted connection';END IF;RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.exited_at IS NOT NULL OR NEW.exited_at IS NULL OR to_jsonb(NEW)-ARRAY['exited_at','exit_digest','recovery_digest'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['exited_at','exit_digest','recovery_digest']
   OR NEW.exit_digest IS DISTINCT FROM OLD.identity THEN RAISE EXCEPTION 'Session exit cannot replace its original birth';END IF;
  IF NEW.recovery_digest IS NULL THEN
   IF session.digest(to_jsonb(current_setting('crewstation.session_exit',true))) IS DISTINCT FROM OLD.exit_key_hash THEN RAISE EXCEPTION 'Session exit requires its private original finally';END IF;
  ELSE
   pod:=jsonb_build_object('podUid',OLD.original_process->>'podUid','nodeUid',OLD.original_process->>'nodeUid','nodeName',OLD.original_process->>'nodeName');
   IF OLD.original_process IS NULL OR current_setting('crewstation.session_pod_stop',true) IS DISTINCT FROM session.digest(pod)
    OR NOT EXISTS(SELECT 1 FROM session.process_stops WHERE identity=session.digest(pod) AND original_process=pod AND digest=NEW.recovery_digest) THEN
    RAISE EXCEPTION 'Session recovery requires the complete original protected Pod stop';END IF;
  END IF;RETURN NEW;
 END IF;
 SELECT project_id INTO project FROM session.task_origins WHERE task_key=OLD.task_key;
 SELECT * INTO scope FROM session.project_deletions WHERE project_id=project;
 IF NOT FOUND OR OLD.exited_at IS NULL OR NOT scope.verified OR NOT scope.phases ? 'namespace'
  OR current_setting('crewstation.session_deletion',true) IS DISTINCT FROM scope.operation_id||':'||scope.generation||':metadata' THEN
  RAISE EXCEPTION 'Session birth requires its completed metadata owner';END IF;RETURN OLD;
END $$;
