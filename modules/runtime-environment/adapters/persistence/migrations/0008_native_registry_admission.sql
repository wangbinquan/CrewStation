-- Native registry cleanup and catalog pin updates use the same actual global backend lock.
CREATE FUNCTION runtime_environment.native_registry_admitted() RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE admitted text:=current_setting('crewstation.shared_admission_pid',true); key_hash bigint:=hashtextextended('storage.registry-admission',0);
BEGIN
  IF admitted IS NULL OR admitted !~ '^[1-9][0-9]*$' THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted AND mode='ShareLock' AND pid=admitted::integer
    AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
    AND classid=((key_hash>>32)&4294967295)::oid AND objid=(key_hash&4294967295)::oid AND objsubid=1);
END $$;

CREATE OR REPLACE FUNCTION runtime_environment.callback_birth_valid(body jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE resource_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  original jsonb:=body->'original_process'; projects jsonb:=body->'original_project_ids'; ordered jsonb;
BEGIN
  IF jsonb_typeof(original) IS DISTINCT FROM 'object' OR jsonb_typeof(projects) IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  IF body->>'id' !~ resource_pattern OR body->>'consumer_id' !~ resource_pattern
    OR (body->>'backend_pid')::integer<=0 OR (body->>'callback_pid')::integer<=0
    OR body->>'input_digest' !~ '^[a-f0-9]{64}$' OR body->>'exit_key_hash' !~ '^[a-f0-9]{64}$'
    OR body->>'callback_started_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?Z$'
    OR original->>'podUid' !~ uuid_pattern OR original->>'nodeUid' !~ uuid_pattern
    OR original->>'containerId' !~ '^[a-z0-9]+://[a-f0-9]{64}$' OR length(original->>'nodeName') NOT BETWEEN 1 AND 253
    OR original-ARRAY['podUid','nodeUid','containerId','nodeName']<>'{}'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_each(original) AS field WHERE jsonb_typeof(to_jsonb(field)->'value') IS DISTINCT FROM 'string')
    OR NOT original ?& ARRAY['podUid','nodeUid','containerId','nodeName'] THEN RETURN false;END IF;
  PERFORM (body->>'callback_started_at')::timestamptz;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(projects) AS item WHERE jsonb_typeof(item) IS DISTINCT FROM 'string' OR item#>>'{}' !~ resource_pattern) THEN RETURN false;END IF;
  SELECT jsonb_agg(project ORDER BY project COLLATE "C") INTO ordered FROM (SELECT DISTINCT jsonb_array_elements_text(projects) AS project) AS project_set;
  RETURN projects=COALESCE(ordered,'[]'::jsonb);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION runtime_environment.guard_project_callbacks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_body jsonb; after_body jsonb; project text; owner_exit boolean; callback_key text:=current_setting('crewstation.runtime_callback_exit',true);
BEGIN
  IF TG_OP<>'INSERT' THEN before_body:=to_jsonb(OLD);END IF;
  IF TG_OP<>'DELETE' THEN after_body:=to_jsonb(NEW);END IF;
  IF TG_OP='INSERT' THEN
    IF NOT runtime_environment.native_registry_admitted() THEN RAISE EXCEPTION 'Registry callback requires real global admission' USING ERRCODE='55000'; END IF;
    IF runtime_environment.callback_birth_valid(after_body) IS DISTINCT FROM true
      OR NEW.project_ids<>NEW.original_project_ids OR NEW.exited_at IS NOT NULL OR NEW.exit_digest IS NOT NULL OR NEW.recovery_digest IS NOT NULL
      OR NEW.kind NOT IN ('build','validation','source','initializer') OR NEW.backend_pid::text IS DISTINCT FROM current_setting('crewstation.shared_admission_pid',true) THEN
      RAISE EXCEPTION 'Runtime image callback requires original admitted birth' USING ERRCODE='55000';
    END IF;
    FOR project IN SELECT jsonb_array_elements_text(NEW.project_ids) ORDER BY 1 LOOP
      IF NOT runtime_environment.deletion_admitted(project) THEN RAISE EXCEPTION 'Runtime image callback requires real original shared locks' USING ERRCODE='55000'; END IF;
      PERFORM runtime_environment.assert_project_write(project,'INSERT');
    END LOOP;
    IF EXISTS(SELECT 1 FROM runtime_environment.deletion_entities WHERE kind='deletion_callbacks' AND entity_key=NEW.id) THEN RAISE EXCEPTION 'Runtime image original callback cannot be recreated' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' OR NEW.project_ids IS DISTINCT FROM OLD.project_ids THEN
    IF jsonb_array_length(OLD.original_project_ids)=0 THEN RAISE EXCEPTION 'Platform callback birth cannot be removed by a project owner' USING ERRCODE='55000'; END IF;
    IF OLD.exited_at IS NULL OR OLD.exit_digest IS DISTINCT FROM runtime_environment.callback_receipt(before_body,OLD.recovery_digest) THEN RAISE EXCEPTION 'Runtime image original callback has not exited' USING ERRCODE='55000'; END IF;
    IF TG_OP='UPDATE' AND (before_body-'project_ids' IS DISTINCT FROM after_body-'project_ids' OR NOT OLD.project_ids @> NEW.project_ids OR jsonb_array_length(NEW.project_ids)=0 OR jsonb_array_length(NEW.project_ids)>=jsonb_array_length(OLD.project_ids)) THEN
      RAISE EXCEPTION 'Runtime image callback membership can only shrink without replacing birth' USING ERRCODE='55000';
    END IF;
    FOR project IN SELECT jsonb_array_elements_text(OLD.project_ids) EXCEPT SELECT jsonb_array_elements_text(CASE WHEN TG_OP='DELETE' THEN '[]'::jsonb ELSE NEW.project_ids END) LOOP
      IF NOT runtime_environment.deletion_control_owner(project,'metadata') THEN RAISE EXCEPTION 'Runtime image callback removal requires original metadata owner' USING ERRCODE='55000'; END IF;
    END LOOP;
    IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
  END IF;
  IF before_body-ARRAY['exited_at','exit_digest','recovery_digest'] IS DISTINCT FROM after_body-ARRAY['exited_at','exit_digest','recovery_digest'] OR OLD.exited_at IS NOT NULL OR NEW.exited_at IS NULL
    OR NEW.exit_digest IS DISTINCT FROM runtime_environment.callback_receipt(before_body,NEW.recovery_digest) THEN RAISE EXCEPTION 'Runtime image callback birth and exit are immutable' USING ERRCODE='55000'; END IF;
  IF NEW.recovery_digest IS NULL THEN
    IF callback_key IS NULL OR runtime_environment.deletion_hash(to_jsonb(callback_key)) IS DISTINCT FROM OLD.exit_key_hash THEN RAISE EXCEPTION 'Runtime image callback exit requires original private key' USING ERRCODE='55000'; END IF;
  ELSE
    SELECT bool_or(runtime_environment.deletion_control_owner(value,'stop')) INTO owner_exit FROM jsonb_array_elements_text(OLD.project_ids) AS entry(value);
    IF NOT COALESCE(owner_exit,false) THEN RAISE EXCEPTION 'Runtime image callback recovery requires original stop owner' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION runtime_environment.guard_native_registry_catalog() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT runtime_environment.native_registry_admitted() THEN RAISE EXCEPTION 'Registry catalog mutation requires real global admission' USING ERRCODE='55000'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER runtime_native_registry_catalog_guard BEFORE INSERT OR UPDATE OR DELETE ON runtime_environment.versions
  FOR EACH ROW EXECUTE FUNCTION runtime_environment.guard_native_registry_catalog();
