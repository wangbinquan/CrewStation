-- Immutable original physical scope and phase receipts. Existing journal facts are never backfilled.
ALTER TABLE data_control.deletion_fences ADD COLUMN completed_digest text CHECK(completed_digest ~ '^[a-f0-9]{64}$'), ADD COLUMN completed_count integer NOT NULL DEFAULT 0 CHECK(completed_count>=0);
CREATE TABLE data_control.deletion_scopes(
  project_id text PRIMARY KEY,operation_id text NOT NULL,original jsonb NOT NULL,
  stop_digest text CHECK(stop_digest ~ '^[a-f0-9]{64}$'),purge_digest text CHECK(purge_digest ~ '^[a-f0-9]{64}$'),prove_digest text CHECK(prove_digest ~ '^[a-f0-9]{64}$'),
  metadata_purged boolean NOT NULL DEFAULT false,
  CHECK(jsonb_typeof(original)='object' AND original->>'version'='1' AND jsonb_typeof(original->'plan'->'keys')='array')
);
CREATE FUNCTION data_control.actual_deletion(target text,required_phase text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM data_control.deletion_fences AS f WHERE f.project_id=target AND f.operation_id=current_setting('crewstation.data_control_deletion',true)
    AND required_phase=current_setting('crewstation.data_control_deletion_phase',true)
    AND f.generation::text=current_setting('crewstation.data_control_deletion_generation',true)
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND mode='ExclusiveLock' AND pid=pg_backend_pid()
      AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND objsubid=1
      AND classid::bigint=((hashtextextended('data-control.project-admission:' || target,0)>>32)&4294967295)
      AND objid::bigint=(hashtextextended('data-control.project-admission:' || target,0)&4294967295)))
$$;
CREATE FUNCTION data_control.guard_deletion_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text; phase text;
BEGIN
  target:=CASE WHEN TG_OP='DELETE' THEN OLD.project_id ELSE NEW.project_id END;
  phase:=current_setting('crewstation.data_control_deletion_phase',true);
  IF phase NOT IN ('seal','stop','purge','prove','metadata','verify') OR NOT data_control.actual_deletion(target,phase) THEN
    RAISE EXCEPTION 'native scope requires actual exclusive deletion admission' USING ERRCODE='55000';
  END IF;
  IF TG_OP='INSERT' THEN
    IF phase<>'seal' OR NEW.operation_id IS DISTINCT FROM current_setting('crewstation.data_control_deletion',true) OR NEW.stop_digest IS NOT NULL OR NEW.purge_digest IS NOT NULL OR NEW.prove_digest IS NOT NULL OR NEW.metadata_purged THEN
      RAISE EXCEPTION 'native scope must precede actual phase receipts' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF phase<>'verify' OR NOT OLD.metadata_purged OR OLD.stop_digest IS NULL OR OLD.purge_digest IS NULL OR OLD.prove_digest IS NULL OR
      NOT EXISTS(SELECT 1 FROM data_control.deletion_fences WHERE project_id=target AND scope_verified AND completed_digest IS NOT NULL) THEN
      RAISE EXCEPTION 'native scope cannot disappear before final verification' USING ERRCODE='55000';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.project_id,NEW.operation_id,NEW.original) IS DISTINCT FROM (OLD.project_id,OLD.operation_id,OLD.original) THEN
    RAISE EXCEPTION 'original native physical scope is immutable' USING ERRCODE='55000';
  END IF;
  IF (OLD.stop_digest IS NOT NULL AND NEW.stop_digest IS DISTINCT FROM OLD.stop_digest) OR (NEW.stop_digest IS DISTINCT FROM OLD.stop_digest AND phase<>'stop') OR
    (OLD.purge_digest IS NOT NULL AND NEW.purge_digest IS DISTINCT FROM OLD.purge_digest) OR (NEW.purge_digest IS DISTINCT FROM OLD.purge_digest AND (phase<>'purge' OR NEW.stop_digest IS NULL)) OR
    (OLD.prove_digest IS NOT NULL AND NEW.prove_digest IS DISTINCT FROM OLD.prove_digest) OR (NEW.prove_digest IS DISTINCT FROM OLD.prove_digest AND (phase<>'prove' OR NEW.purge_digest IS NULL)) OR
    (OLD.metadata_purged AND NOT NEW.metadata_purged) OR (NEW.metadata_purged IS DISTINCT FROM OLD.metadata_purged AND (phase<>'metadata' OR NEW.prove_digest IS NULL)) THEN
    RAISE EXCEPTION 'native phase receipt cannot be replaced or skip its predecessor' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_control_scope_guard BEFORE INSERT OR UPDATE OR DELETE ON data_control.deletion_scopes FOR EACH ROW EXECUTE FUNCTION data_control.guard_deletion_scope();
CREATE FUNCTION data_control.guard_verified_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'native deletion tombstone cannot be removed' USING ERRCODE='55000'; END IF;
  IF NEW.scope_verified IS DISTINCT FROM OLD.scope_verified AND (OLD.scope_verified OR NOT NEW.scope_verified OR NOT data_control.actual_deletion(OLD.project_id,'metadata') OR
    NOT EXISTS(SELECT 1 FROM data_control.deletion_scopes WHERE project_id=OLD.project_id AND stop_digest IS NOT NULL AND purge_digest IS NOT NULL AND prove_digest IS NOT NULL)) THEN
    RAISE EXCEPTION 'native verification requires actual physical phase receipts' USING ERRCODE='55000';
  END IF;
  IF (NEW.completed_digest,NEW.completed_count) IS DISTINCT FROM (OLD.completed_digest,OLD.completed_count) AND (OLD.completed_digest IS NOT NULL OR NOT data_control.actual_deletion(OLD.project_id,'verify') OR
    NOT EXISTS(SELECT 1 FROM data_control.deletion_scopes WHERE project_id=OLD.project_id AND metadata_purged AND stop_digest IS NOT NULL AND purge_digest IS NOT NULL AND prove_digest IS NOT NULL)) THEN
    RAISE EXCEPTION 'native completion requires actual final admission and empty metadata' USING ERRCODE='55000';
  END IF;
  IF OLD.completed_digest IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'native completed tombstone is immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_control_verified_fence BEFORE UPDATE OR DELETE ON data_control.deletion_fences FOR EACH ROW EXECUTE FUNCTION data_control.guard_verified_fence();
CREATE OR REPLACE FUNCTION data_control.guard_entity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'original database resource ownership is immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='DELETE' THEN
    IF NOT data_control.actual_deletion(OLD.project_id,'metadata') OR NOT EXISTS(SELECT 1 FROM data_control.deletion_fences WHERE project_id=OLD.project_id AND scope_verified) OR
      EXISTS(SELECT 1 FROM data_control.credentials WHERE resource_id=OLD.resource_id) OR EXISTS(SELECT 1 FROM data_control.deletion_work WHERE resource_id=OLD.resource_id) THEN
      RAISE EXCEPTION 'original native ownership requires verified credential and journal purge' USING ERRCODE='55000';
    END IF;
    RETURN OLD;
  END IF;
  IF data_control.actual_deletion(NEW.project_id,'seal') AND EXISTS(SELECT 1 FROM data_control.deletion_scopes WHERE project_id=NEW.project_id AND original->'plan'->'keys' ? NEW.resource_id) THEN RETURN NEW; END IF;
  IF NOT data_control.actual_admission(NEW.project_id) OR EXISTS(SELECT 1 FROM data_control.deletion_fences WHERE project_id=NEW.project_id AND operation_id IS NOT NULL) THEN
    RAISE EXCEPTION 'database project admission is closed or unprotected' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
-- Add a deletion-only guard without weakening the released work/journal update protections.
CREATE FUNCTION data_control.guard_verified_work_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state='running' THEN RAISE EXCEPTION 'original native work has not exited' USING ERRCODE='55000'; END IF;
  IF NOT data_control.actual_deletion(OLD.project_id,'metadata') OR NOT EXISTS(SELECT 1 FROM data_control.deletion_fences WHERE project_id=OLD.project_id AND scope_verified) THEN
    RAISE EXCEPTION 'original native journal requires actual verified metadata admission' USING ERRCODE='55000';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER data_control_verified_work_delete BEFORE DELETE ON data_control.deletion_work FOR EACH ROW EXECUTE FUNCTION data_control.guard_verified_work_delete();
CREATE FUNCTION data_control.guard_verified_credential_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;
BEGIN
  SELECT project_id INTO target FROM data_control.deletion_entities WHERE resource_id=OLD.resource_id;
  IF target IS NULL OR NOT data_control.actual_deletion(target,'metadata') OR NOT EXISTS(SELECT 1 FROM data_control.deletion_fences WHERE project_id=target AND scope_verified) THEN
    RAISE EXCEPTION 'native credential requires actual verified metadata admission' USING ERRCODE='55000';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER data_control_verified_credential_delete BEFORE DELETE ON data_control.credentials FOR EACH ROW EXECUTE FUNCTION data_control.guard_verified_credential_delete();
