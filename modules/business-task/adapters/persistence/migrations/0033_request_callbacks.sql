-- Include original service and legacy request preparation without changing locked worker migrations.
CREATE OR REPLACE FUNCTION business_task.guard_work_callbacks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_body jsonb;after_body jsonb;private_key text:=current_setting('crewstation.business_task_callback_exit',true);BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original business callbacks require a completed metadata owner';END IF;
 after_body:=to_jsonb(NEW);
 IF TG_OP='INSERT' THEN
  IF business_task.work_birth_valid(after_body) IS DISTINCT FROM true OR NEW.kind NOT IN('task-admission','subtask','projection','cancellation','lifecycle','message','agent-cleanup','service-api','legacy-api','contract') OR NEW.exited_at IS NOT NULL OR NEW.exit_digest IS NOT NULL OR NEW.recovery_digest IS NOT NULL
    OR NOT business_task.work_admitted(NEW.project_id,NEW.backend_pid) THEN RAISE EXCEPTION 'Business callback requires actual admitted original birth';END IF;
  IF EXISTS(SELECT 1 FROM business_task.project_admissions WHERE project_id=NEW.project_id) THEN RAISE EXCEPTION 'Business admission is permanently sealed';END IF;
  RETURN NEW;
 END IF;
 before_body:=to_jsonb(OLD);
 IF before_body-ARRAY['exited_at','exit_digest','recovery_digest'] IS DISTINCT FROM after_body-ARRAY['exited_at','exit_digest','recovery_digest'] OR OLD.exited_at IS NOT NULL OR NEW.exited_at IS NULL
   OR NEW.exit_digest IS DISTINCT FROM business_task.work_identity(before_body,NEW.recovery_digest) THEN RAISE EXCEPTION 'Original business callback identity is immutable';END IF;
 IF NEW.recovery_digest IS NULL THEN
  IF private_key IS NULL OR business_task.work_digest(to_jsonb(private_key)) IS DISTINCT FROM OLD.exit_key_hash THEN RAISE EXCEPTION 'Business exit requires the private original finally';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM business_task.callback_pod_stops WHERE identity=current_setting('crewstation.business_task_pod_recovery',true)
   AND digest=NEW.recovery_digest AND original_process=OLD.original_process-ARRAY['containerId','pid','pidNamespace','bootId','startTicks']) THEN RAISE EXCEPTION 'Business recovery requires original whole Pod stop proof';END IF;
 END IF;
 RETURN NEW;
END $$;
