-- A protected original Pod's complete termination covers every PID in it, including container histories no longer retained by K8s.
CREATE TABLE provisioning.pod_stops(identity text PRIMARY KEY,original_process jsonb NOT NULL,digest text NOT NULL);
CREATE FUNCTION provisioning.guard_pod_stops() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP<>'INSERT' OR NEW.identity IS DISTINCT FROM provisioning.digest(NEW.original_process)
  OR NEW.digest!~'^[a-f0-9]{64}$' OR current_setting('crewstation.provisioning_callback_pod_stop',true) IS DISTINCT FROM provisioning.digest(jsonb_build_object('process',NEW.original_process,'digest',NEW.digest))
  OR jsonb_typeof(NEW.original_process) IS DISTINCT FROM 'object' OR NEW.original_process-ARRAY['podUid','nodeUid','nodeName']<>'{}'::jsonb
  OR NOT NEW.original_process ?& ARRAY['podUid','nodeUid','nodeName'] THEN
  RAISE EXCEPTION 'Provisioning Pod stop requires the protected original observer';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER provisioning_pod_stop_guard BEFORE INSERT OR UPDATE OR DELETE ON provisioning.pod_stops FOR EACH ROW EXECUTE FUNCTION provisioning.guard_pod_stops();
CREATE TRIGGER provisioning_pod_stop_truncate BEFORE TRUNCATE ON provisioning.pod_stops FOR EACH STATEMENT EXECUTE FUNCTION provisioning.reject_truncate();
CREATE OR REPLACE FUNCTION provisioning.guard_callbacks() RETURNS trigger LANGUAGE plpgsql AS $$
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
    AND digest=NEW.recovery_digest AND original_process=OLD.original_process-ARRAY['pid','pidNamespace','bootId','startTicks'])
   AND NOT EXISTS(SELECT 1 FROM provisioning.pod_stops WHERE identity=current_setting('crewstation.provisioning_callback_pod_recovery',true)
    AND digest=NEW.recovery_digest AND original_process=OLD.original_process-ARRAY['containerId','pid','pidNamespace','bootId','startTicks']) THEN
   RAISE EXCEPTION 'Provisioning recovery requires original stopped container or whole Pod proof';END IF;
 END IF;
 RETURN NEW;
END $$;
