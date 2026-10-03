-- Minimal original scope and durable phase receipts; no payload, error, trace or exit key is retained here.
CREATE TABLE provisioning.deletion_scopes(
 project_id text PRIMARY KEY,operation_id text NOT NULL,generation integer NOT NULL CHECK(generation>0),
 revision text NOT NULL,body jsonb NOT NULL,phases jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE FUNCTION provisioning.guard_deletion_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phase text;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Original provisioning deletion tombstone cannot be removed';END IF;
 phase:=split_part(current_setting('crewstation.provisioning_deletion_owner',true),':',3);
 IF phase IS NULL OR phase NOT IN('seal','stop','purge','prove','namespace','metadata','verify')
  OR current_setting('crewstation.provisioning_deletion_owner',true) IS DISTINCT FROM NEW.operation_id||':'||NEW.generation||':'||phase
  OR NOT provisioning.locked(NEW.project_id,'ExclusiveLock',pg_backend_pid())
  OR NOT EXISTS(SELECT 1 FROM provisioning.project_admissions WHERE project_id=NEW.project_id AND operation_id=NEW.operation_id AND generation<=NEW.generation)
  OR NEW.revision!~'^[a-f0-9]{64}$' OR NEW.body->>'originDigest'!~'^[a-f0-9]{64}$'
  OR jsonb_typeof(NEW.body) IS DISTINCT FROM 'object' OR NEW.body-ARRAY['callbacks','contents','count','originDigest','compacted']<>'{}'::jsonb
  OR NOT NEW.body ?& ARRAY['callbacks','contents','count','originDigest','compacted']
  OR jsonb_typeof(NEW.phases) IS DISTINCT FROM 'object' OR NEW.phases-ARRAY['seal','stop','purge','prove','namespace','metadata','verify']<>'{}'::jsonb THEN
  RAISE EXCEPTION 'Provisioning deletion scope requires the original exclusive grant';END IF;
 IF TG_OP='INSERT' THEN
  IF phase<>'seal' OR NEW.phases<>'{}'::jsonb OR NEW.body->>'compacted'<>'false' THEN RAISE EXCEPTION 'Original provisioning scope begins only at seal';END IF;
  RETURN NEW;
 END IF;
 IF NEW.project_id<>OLD.project_id OR NEW.operation_id<>OLD.operation_id OR NEW.generation<OLD.generation THEN RAISE EXCEPTION 'Original provisioning operation cannot be replaced';END IF;
 IF phase='seal' AND NEW.generation>OLD.generation AND NEW.revision<>OLD.revision THEN
  IF NEW.phases<>'{}'::jsonb OR NEW.body->>'compacted'<>'false' THEN RAISE EXCEPTION 'Reconfirmation requires a fresh exact scope';END IF;
  RETURN NEW;
 END IF;
 IF NEW.revision<>OLD.revision OR NEW.phases-phase IS DISTINCT FROM OLD.phases-phase
  OR OLD.phases ? phase AND NEW.phases->phase IS DISTINCT FROM OLD.phases->phase THEN RAISE EXCEPTION 'Provisioning original revision and phase proofs are immutable';END IF;
 IF NEW.body IS DISTINCT FROM OLD.body AND(phase<>'metadata' OR NOT OLD.phases ? 'namespace'
  OR NEW.body IS DISTINCT FROM jsonb_build_object('callbacks','[]'::jsonb,'contents','[]'::jsonb,'count',OLD.body->'count','originDigest',OLD.body->'originDigest','compacted',true)
  OR EXISTS(SELECT 1 FROM provisioning.original_callbacks WHERE project_id=NEW.project_id)) THEN RAISE EXCEPTION 'Provisioning original scope only compacts after callback removal';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER provisioning_deletion_scope_guard BEFORE INSERT OR UPDATE OR DELETE ON provisioning.deletion_scopes FOR EACH ROW EXECUTE FUNCTION provisioning.guard_deletion_scope();
CREATE TRIGGER provisioning_deletion_scope_truncate BEFORE TRUNCATE ON provisioning.deletion_scopes FOR EACH STATEMENT EXECUTE FUNCTION provisioning.reject_truncate();
CREATE OR REPLACE FUNCTION provisioning.guard_callbacks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_body jsonb;after_body jsonb;callback_key text:=current_setting('crewstation.provisioning_callback_exit',true);BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.exited_at IS NULL OR NOT provisioning.locked(OLD.project_id,'ExclusiveLock',pg_backend_pid())
   OR NOT EXISTS(SELECT 1 FROM provisioning.deletion_scopes scope WHERE scope.project_id=OLD.project_id
    AND current_setting('crewstation.provisioning_deletion_owner',true)=scope.operation_id||':'||scope.generation||':metadata'
    AND scope.phases ?& ARRAY['seal','stop','purge','prove','namespace'] AND scope.body->>'compacted'='false'
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(scope.body->'callbacks') original WHERE original->>'id'=OLD.id
     AND original->>'identity'=provisioning.callback_identity(to_jsonb(OLD)))) THEN
   RAISE EXCEPTION 'Original provisioning callbacks require their completed metadata owner';END IF;
  RETURN OLD;
 END IF;
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
