ALTER TABLE business_task.legacy_mutations ADD COLUMN callback_id text;
CREATE FUNCTION business_task.guard_legacy_callback() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE birth business_task.original_callbacks%ROWTYPE;BEGIN
 IF TG_OP='UPDATE' AND NEW.callback_id IS DISTINCT FROM OLD.callback_id THEN RAISE EXCEPTION 'Legacy original callback cannot be replaced';END IF;
 IF TG_OP='INSERT' AND NEW.callback_id IS NOT NULL THEN
 SELECT * INTO birth FROM business_task.original_callbacks WHERE id=NEW.callback_id;
 IF NOT FOUND OR birth.service_id<>NEW.service_id OR birth.kind<>'legacy-api' OR birth.exited_at IS NOT NULL
 OR NOT business_task.work_admitted(birth.project_id,birth.backend_pid) THEN RAISE EXCEPTION 'Legacy ticket requires its actual original admitted callback';END IF;END IF;RETURN NEW;
END $$;
CREATE TRIGGER business_legacy_callback_guard BEFORE INSERT OR UPDATE ON business_task.legacy_mutations FOR EACH ROW EXECUTE FUNCTION business_task.guard_legacy_callback();
