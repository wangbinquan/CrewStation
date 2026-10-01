-- Append real pre/post callback facts. Legacy NULLs remain unknown; never reconstruct lost OIDs.
ALTER TABLE data_control.deletion_work
  ADD COLUMN journal_version integer CHECK(journal_version=1),
  ADD COLUMN catalog_before jsonb,
  ADD COLUMN catalog_after jsonb,
  ADD COLUMN storage_before jsonb,
  ADD COLUMN storage_after jsonb;
CREATE FUNCTION data_control.valid_native_catalog(facts jsonb,names jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; seen text[]:=ARRAY[]::text[]; identity text;
BEGIN
  IF jsonb_typeof(facts) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR item IN SELECT jsonb_array_elements(facts) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'kind') IS DISTINCT FROM 'string' OR item->>'kind' NOT IN ('database','role') OR
      jsonb_typeof(item->'name') IS DISTINCT FROM 'string' OR NOT names ? (item->>'name') OR
      jsonb_typeof(item->'oid') IS DISTINCT FROM 'string' OR item->>'oid' !~ '^[1-9][0-9]{0,9}$' OR
      item - ARRAY['kind','name','oid'] <> '{}'::jsonb THEN RETURN false; END IF;
    IF (item->>'oid')::numeric>4294967295 THEN RETURN false; END IF;
    identity:=(item->>'kind') || ':' || (item->>'name');
    IF identity=ANY(seen) THEN RETURN false; END IF;
    seen:=array_append(seen,identity);
  END LOOP;
  RETURN true;
END $$;
CREATE FUNCTION data_control.guard_native_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE marker text;
BEGIN
  IF TG_OP='DELETE' THEN
    IF NOT EXISTS(SELECT 1 FROM data_control.deletion_fences WHERE project_id=OLD.project_id AND scope_verified AND operation_id=current_setting('crewstation.data_control_deletion',true)) THEN
      RAISE EXCEPTION 'original native journal requires verified project purge' USING ERRCODE='55000';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.catalog_before IS NOT NULL OR NEW.catalog_after IS NOT NULL OR NEW.storage_before IS NOT NULL OR NEW.storage_after IS NOT NULL THEN
      RAISE EXCEPTION 'native journal must follow original session admission' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.journal_version IS DISTINCT FROM OLD.journal_version THEN
    RAISE EXCEPTION 'original native journal version is immutable' USING ERRCODE='55000';
  END IF;
  IF (NEW.catalog_before,NEW.catalog_after,NEW.storage_before,NEW.storage_after) IS NOT DISTINCT FROM (OLD.catalog_before,OLD.catalog_after,OLD.storage_before,OLD.storage_after) THEN RETURN NEW; END IF;
  IF (OLD.catalog_before IS NOT NULL AND (NEW.catalog_before,NEW.storage_before) IS DISTINCT FROM (OLD.catalog_before,OLD.storage_before)) OR
    (OLD.catalog_after IS NOT NULL AND (NEW.catalog_after,NEW.storage_after) IS DISTINCT FROM (OLD.catalog_after,OLD.storage_after)) THEN
    RAISE EXCEPTION 'original native journal identity is immutable' USING ERRCODE='55000';
  END IF;
  marker:=current_setting('crewstation.data_control_work_journal',true);
  IF OLD.journal_version IS DISTINCT FROM 1 OR OLD.state<>'running' OR NEW.state<>'running' OR OLD.native_pid IS NULL OR marker IS DISTINCT FROM OLD.work_id OR NOT data_control.actual_admission(OLD.project_id) THEN
    RAISE EXCEPTION 'native journal lacks original running admission' USING ERRCODE='55000';
  END IF;
  IF NEW.catalog_before IS NULL OR NOT data_control.valid_native_catalog(NEW.catalog_before,OLD.names) OR
    (NEW.catalog_after IS NOT NULL AND NOT data_control.valid_native_catalog(NEW.catalog_after,OLD.names)) OR
    (NEW.storage_before IS NOT NULL AND jsonb_typeof(NEW.storage_before) IS DISTINCT FROM 'object') OR
    (NEW.storage_after IS NOT NULL AND (NEW.catalog_after IS NULL OR jsonb_typeof(NEW.storage_after) IS DISTINCT FROM 'object')) THEN
    RAISE EXCEPTION 'native journal has incomplete original identities' USING ERRCODE='55000';
  END IF;
  -- jsonb null is not a SQL NULL and cannot stand for a verified source.
  IF NEW.storage_before='null'::jsonb OR NEW.storage_after='null'::jsonb THEN
    RAISE EXCEPTION 'native journal unknown source must remain SQL NULL' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_control_work_journal_guard BEFORE INSERT OR UPDATE OR DELETE ON data_control.deletion_work FOR EACH ROW EXECUTE FUNCTION data_control.guard_native_journal();
