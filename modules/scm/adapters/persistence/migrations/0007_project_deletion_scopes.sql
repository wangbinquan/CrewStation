-- Append-only: original callback admission and origin facts in 0005/0006 remain unchanged.
ALTER TABLE scm.deletion_fences ADD COLUMN confirmed_revision text, ADD COLUMN scope_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN completed_digest text CHECK(completed_digest IS NULL OR completed_digest~'^[a-f0-9]{64}$'),
  ADD COLUMN completed_count bigint NOT NULL DEFAULT 0 CHECK(completed_count>=0);
CREATE TABLE scm.deletion_scopes(
  project_id text PRIMARY KEY,operation_id text NOT NULL,original jsonb NOT NULL,
  stop_digest text CHECK(stop_digest IS NULL OR stop_digest~'^[a-f0-9]{64}$'),
  purge_digest text CHECK(purge_digest IS NULL OR purge_digest~'^[a-f0-9]{64}$'),
  prove_digest text CHECK(prove_digest IS NULL OR prove_digest~'^[a-f0-9]{64}$'),
  metadata_purged boolean NOT NULL DEFAULT false,
  CHECK(original->>'version'='1' AND original->'plan'->>'projectId'=project_id)
);
CREATE FUNCTION scm.actual_exclusive_admission(target text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND mode='ExclusiveLock' AND pid=pg_backend_pid()
    AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND objsubid=1
    AND classid::bigint=((hashtextextended('scm.project-admission:' || target,0) >> 32) & 4294967295)
    AND objid::bigint=(hashtextextended('scm.project-admission:' || target,0) & 4294967295))
$$;
CREATE FUNCTION scm.original_deletion_context(target text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT scm.actual_exclusive_admission(target) AND EXISTS(SELECT 1 FROM scm.deletion_fences
    WHERE project_id=target AND operation_id=current_setting('crewstation.scm_deletion',true)
      AND generation::text=current_setting('crewstation.scm_deletion_generation',true))
$$;
CREATE FUNCTION scm.permitted_metadata_cleanup(target text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT scm.original_deletion_context(target) AND current_setting('crewstation.scm_deletion_phase',true)='metadata'
    AND EXISTS(SELECT 1 FROM scm.deletion_fences WHERE project_id=target AND scope_verified AND completed_digest IS NULL)
    AND EXISTS(SELECT 1 FROM scm.deletion_scopes WHERE project_id=target
      AND operation_id=current_setting('crewstation.scm_deletion',true) AND stop_digest IS NOT NULL AND purge_digest IS NOT NULL AND prove_digest IS NOT NULL)
$$;
CREATE FUNCTION scm.guard_deletion_fence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phase text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SCM retirement is permanent' USING ERRCODE='55000'; END IF;
  phase:=current_setting('crewstation.scm_deletion_phase',true);
  IF NOT scm.actual_exclusive_admission(NEW.project_id) THEN RAISE EXCEPTION 'SCM deletion fence requires original exclusive admission' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' THEN
    IF phase IS DISTINCT FROM 'seal' OR NEW.operation_id IS NOT NULL OR NEW.generation<>0 OR NEW.confirmed_revision IS NOT NULL OR NEW.scope_verified OR NEW.completed_digest IS NOT NULL OR NEW.completed_count<>0 THEN
      RAISE EXCEPTION 'SCM retirement must start from an empty original fence' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.project_id IS DISTINCT FROM NEW.project_id OR OLD.completed_digest IS NOT NULL
    OR NEW.operation_id IS DISTINCT FROM current_setting('crewstation.scm_deletion',true)
    OR NEW.generation::text IS DISTINCT FROM current_setting('crewstation.scm_deletion_generation',true)
    OR OLD.operation_id IS NOT NULL AND OLD.operation_id IS DISTINCT FROM NEW.operation_id OR OLD.generation>NEW.generation
    OR OLD.operation_id IS NOT NULL AND OLD.generation=NEW.generation AND OLD.confirmed_revision IS DISTINCT FROM NEW.confirmed_revision THEN
    RAISE EXCEPTION 'SCM original retirement identity is immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.operation_id=NEW.operation_id AND NEW.generation>=OLD.generation AND (to_jsonb(OLD)-'generation')=(to_jsonb(NEW)-'generation') THEN RETURN NEW; END IF;
  IF phase='seal' AND (to_jsonb(OLD)-'operation_id'-'generation'-'confirmed_revision')=(to_jsonb(NEW)-'operation_id'-'generation'-'confirmed_revision') THEN RETURN NEW; END IF;
  IF phase='metadata' AND scm.original_deletion_context(OLD.project_id) AND NEW.scope_verified
    AND (to_jsonb(OLD)-'scope_verified')=(to_jsonb(NEW)-'scope_verified')
    AND EXISTS(SELECT 1 FROM scm.deletion_scopes WHERE project_id=OLD.project_id AND stop_digest IS NOT NULL AND purge_digest IS NOT NULL AND prove_digest IS NOT NULL) THEN RETURN NEW; END IF;
  IF phase='verify' AND scm.original_deletion_context(OLD.project_id) AND NEW.completed_digest IS NOT NULL
    AND (to_jsonb(OLD)-'completed_digest'-'completed_count')=(to_jsonb(NEW)-'completed_digest'-'completed_count')
    AND EXISTS(SELECT 1 FROM scm.deletion_scopes WHERE project_id=OLD.project_id AND metadata_purged) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'SCM fence mutation requires its exact owner phase' USING ERRCODE='55000';
END $$;
CREATE TRIGGER scm_deletion_fence BEFORE INSERT OR UPDATE OR DELETE ON scm.deletion_fences FOR EACH ROW EXECUTE FUNCTION scm.guard_deletion_fence();

CREATE FUNCTION scm.guard_deletion_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;phase text;
BEGIN
  IF TG_OP='DELETE' THEN target:=OLD.project_id; ELSE target:=NEW.project_id; END IF;
  phase:=current_setting('crewstation.scm_deletion_phase',true);
  IF NOT scm.original_deletion_context(target) THEN RAISE EXCEPTION 'SCM original scope requires its exact owner grant' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' THEN
    IF phase IS DISTINCT FROM 'seal' OR NEW.operation_id IS DISTINCT FROM current_setting('crewstation.scm_deletion',true)
      OR NEW.stop_digest IS NOT NULL OR NEW.purge_digest IS NOT NULL OR NEW.prove_digest IS NOT NULL OR NEW.metadata_purged THEN
      RAISE EXCEPTION 'SCM scope must be fixed before physical work' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF phase='verify' AND OLD.metadata_purged AND EXISTS(SELECT 1 FROM scm.deletion_fences WHERE project_id=target AND completed_digest IS NOT NULL) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'SCM original scope must remain until final physical verification' USING ERRCODE='55000';
  END IF;
  IF OLD.project_id IS DISTINCT FROM NEW.project_id OR OLD.operation_id IS DISTINCT FROM NEW.operation_id OR OLD.original IS DISTINCT FROM NEW.original THEN
    RAISE EXCEPTION 'SCM original physical scope is immutable' USING ERRCODE='55000';
  END IF;
  IF phase='stop' AND NEW.stop_digest IS NOT NULL AND (OLD.stop_digest IS NULL OR OLD.stop_digest=NEW.stop_digest)
    AND (to_jsonb(OLD)-'stop_digest')=(to_jsonb(NEW)-'stop_digest') THEN RETURN NEW; END IF;
  IF phase='purge' AND OLD.stop_digest IS NOT NULL AND NEW.purge_digest IS NOT NULL AND (OLD.purge_digest IS NULL OR OLD.purge_digest=NEW.purge_digest)
    AND (to_jsonb(OLD)-'purge_digest')=(to_jsonb(NEW)-'purge_digest') THEN RETURN NEW; END IF;
  IF phase='prove' AND OLD.purge_digest IS NOT NULL AND NEW.prove_digest IS NOT NULL AND (OLD.prove_digest IS NULL OR OLD.prove_digest=NEW.prove_digest)
    AND (to_jsonb(OLD)-'prove_digest')=(to_jsonb(NEW)-'prove_digest') THEN RETURN NEW; END IF;
  IF phase='metadata' AND scm.permitted_metadata_cleanup(target) AND NEW.metadata_purged
    AND (to_jsonb(OLD)-'metadata_purged')=(to_jsonb(NEW)-'metadata_purged') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'SCM phase proof requires its original predecessor' USING ERRCODE='55000';
END $$;
CREATE TRIGGER scm_deletion_scope BEFORE INSERT OR UPDATE OR DELETE ON scm.deletion_scopes FOR EACH ROW EXECUTE FUNCTION scm.guard_deletion_scope();

-- Preserve every ordinary write/journal/origin check; only verified owner metadata DELETE is added.
CREATE OR REPLACE FUNCTION scm.guard_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND scm.permitted_metadata_cleanup(OLD.project_id) THEN RETURN OLD; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'SCM original ownership is immutable' USING ERRCODE='55000'; END IF;
  IF NOT coalesce(scm.actual_shared_admission(NEW.project_id),false) THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('scm.project-admission:' || NEW.project_id,0));
  END IF;
  IF EXISTS(SELECT 1 FROM scm.deletion_fences WHERE project_id=NEW.project_id AND operation_id IS NOT NULL) THEN
    RAISE EXCEPTION 'SCM project is sealed' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION scm.guard_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE service_key text;target text;original_project text;old_target text;entity_key text;
BEGIN
  IF TG_OP='DELETE' THEN
    IF TG_TABLE_NAME='repository_bindings' THEN target:=OLD.project_id; ELSE SELECT project_id INTO target FROM scm.deletion_identities WHERE kind='service' AND id=OLD.service_id; END IF;
    IF scm.permitted_metadata_cleanup(target) THEN RETURN OLD; END IF;
  END IF;
  IF TG_TABLE_NAME='repository_bindings' THEN
    IF TG_OP='DELETE' THEN target:=OLD.project_id;service_key:=OLD.service_id; ELSE target:=NEW.project_id;service_key:=NEW.service_id; END IF;
    IF TG_OP='UPDATE' AND (OLD.service_id IS DISTINCT FROM NEW.service_id OR OLD.project_id IS DISTINCT FROM NEW.project_id) THEN
      RAISE EXCEPTION 'SCM binding ownership is immutable' USING ERRCODE='55000';
    END IF;
  ELSE
    IF TG_OP='DELETE' THEN service_key:=OLD.service_id;entity_key:=OLD.id; ELSE service_key:=NEW.service_id;entity_key:=NEW.id; END IF;
    SELECT project_id INTO target FROM scm.deletion_identities WHERE kind='service' AND id=service_key;
    IF target IS NULL THEN RAISE EXCEPTION 'SCM credential owner is unknown' USING ERRCODE='55000'; END IF;
    IF TG_OP='UPDATE' AND (OLD.id IS DISTINCT FROM NEW.id OR OLD.service_id IS DISTINCT FROM NEW.service_id) THEN
      RAISE EXCEPTION 'SCM credential ownership is immutable' USING ERRCODE='55000';
    END IF;
  END IF;
  IF NOT coalesce(scm.actual_shared_admission(target),false) THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('scm.project-admission:' || target,0));
  END IF;
  IF EXISTS(SELECT 1 FROM scm.deletion_fences WHERE project_id=target AND operation_id IS NOT NULL) THEN
    RAISE EXCEPTION 'SCM project is sealed' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  INSERT INTO scm.deletion_identities VALUES('service',service_key,service_key,target) ON CONFLICT DO NOTHING;
  SELECT project_id INTO original_project FROM scm.deletion_identities WHERE kind='service' AND id=service_key;
  IF original_project IS DISTINCT FROM target THEN RAISE EXCEPTION 'SCM original service belongs to another project' USING ERRCODE='55000'; END IF;
  IF TG_TABLE_NAME='session_credentials' THEN
    INSERT INTO scm.deletion_identities VALUES('credential',entity_key,service_key,target) ON CONFLICT DO NOTHING;
    SELECT project_id INTO original_project FROM scm.deletion_identities WHERE kind='credential' AND id=entity_key AND service_id=service_key;
    IF original_project IS DISTINCT FROM target THEN RAISE EXCEPTION 'SCM original credential belongs to another project' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION scm.guard_callback_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE journal boolean;exiting boolean;
BEGIN
  IF TG_OP='DELETE' AND OLD.state='exited' AND scm.permitted_metadata_cleanup(OLD.project_id) THEN RETURN OLD; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SCM callback evidence requires verified owner cleanup' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' THEN
    IF NOT coalesce(scm.actual_shared_admission(NEW.project_id),false) OR NEW.backend_pid::text IS DISTINCT FROM current_setting('crewstation.shared_admission_pid',true)
      OR NEW.state<>'running' OR NEW.result IS NOT NULL OR NEW.exit_digest IS NOT NULL OR NEW.recovery_digest IS NOT NULL OR NEW.effects<>'[]'::jsonb
      OR EXISTS(SELECT 1 FROM scm.deletion_fences WHERE project_id=NEW.project_id AND operation_id IS NOT NULL)
      OR NOT EXISTS(SELECT 1 FROM scm.deletion_identities WHERE kind='service' AND id=NEW.service_id AND project_id=NEW.project_id) THEN
      RAISE EXCEPTION 'SCM callback requires original live admission' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.project_id IS DISTINCT FROM NEW.project_id OR OLD.service_id IS DISTINCT FROM NEW.service_id
    OR OLD.kind IS DISTINCT FROM NEW.kind OR OLD.remote_project_id IS DISTINCT FROM NEW.remote_project_id OR OLD.backend_pid IS DISTINCT FROM NEW.backend_pid
    OR OLD.callback_pid IS DISTINCT FROM NEW.callback_pid OR OLD.callback_started_at IS DISTINCT FROM NEW.callback_started_at OR OLD.process IS DISTINCT FROM NEW.process THEN
    RAISE EXCEPTION 'SCM callback original identity is immutable' USING ERRCODE='55000';
  END IF;
  journal:=current_setting('crewstation.scm_work_journal',true)=OLD.id || ':' || OLD.backend_pid
    AND OLD.state='running' AND NEW.state=OLD.state AND NEW.result IS NOT DISTINCT FROM OLD.result
    AND NEW.exit_digest IS NOT DISTINCT FROM OLD.exit_digest AND NEW.recovery_digest IS NOT DISTINCT FROM OLD.recovery_digest
    AND jsonb_array_length(NEW.effects)=jsonb_array_length(OLD.effects)+1
    AND (NEW.effects-(jsonb_array_length(NEW.effects)-1))=OLD.effects;
  exiting:=current_setting('crewstation.scm_work_exit',true)=OLD.id || ':' || OLD.backend_pid
    AND OLD.state='running' AND NEW.state='exited' AND NEW.result IS NOT NULL AND NEW.exit_digest IS NOT NULL AND NEW.effects=OLD.effects;
  IF NOT coalesce(journal,false) AND NOT coalesce(exiting,false) THEN
    RAISE EXCEPTION 'SCM callback update requires original journal or exit proof' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION scm.guard_repository_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE callback scm.deletion_work;
BEGIN
  IF TG_OP='DELETE' AND scm.permitted_metadata_cleanup(OLD.project_id) THEN RETURN OLD; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'SCM repository origin is immutable' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM scm.deletion_repository_origins WHERE remote_project_id=NEW.remote_project_id AND project_id<>NEW.project_id)
    OR EXISTS(SELECT 1 FROM scm.repository_bindings WHERE remote_project_id=NEW.remote_project_id AND project_id<>NEW.project_id) THEN
    RAISE EXCEPTION 'SCM original repository belongs to another project' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM scm.deletion_identities WHERE kind='service' AND id=NEW.service_id AND project_id=NEW.project_id) THEN
    RAISE EXCEPTION 'SCM repository origin owner does not match' USING ERRCODE='55000';
  END IF;
  IF NEW.source='callback-result' THEN
    SELECT * INTO callback FROM scm.deletion_work WHERE id=NEW.work_id AND project_id=NEW.project_id AND service_id=NEW.service_id;
    IF callback.state IS DISTINCT FROM 'running' OR current_setting('crewstation.scm_work_journal',true) IS DISTINCT FROM callback.id || ':' || callback.backend_pid
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(callback.effects) e WHERE e->>'kind'='repository' AND e->>'stage'='returned'
        AND e->>'remoteProjectId'=NEW.remote_project_id AND e->>'path'=NEW.path_with_namespace AND (e->>'createdAt') IS NOT DISTINCT FROM NEW.remote_created_at) THEN
      RAISE EXCEPTION 'SCM repository origin requires original returned fact' USING ERRCODE='55000';
    END IF;
  ELSE
    IF NEW.work_id IS NOT NULL OR NEW.remote_created_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM scm.repository_bindings WHERE service_id=NEW.service_id AND project_id=NEW.project_id AND remote_project_id=NEW.remote_project_id AND path_with_namespace=NEW.path_with_namespace) THEN
      RAISE EXCEPTION 'SCM legacy origin requires original binding' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION scm.guard_deletion_alias() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate text;target text;
BEGIN
  FOR candidate IN SELECT DISTINCT value FROM unnest(CASE WHEN TG_OP='INSERT' THEN ARRAY[NEW.id] WHEN TG_OP='DELETE' THEN ARRAY[OLD.id] ELSE ARRAY[OLD.id,NEW.id] END) value LOOP
    FOR target IN SELECT project_id FROM scm.deletion_fences WHERE project_id=candidate
      UNION SELECT project_id FROM scm.deletion_identities WHERE id=candidate LOOP
      IF NOT coalesce(scm.actual_shared_admission(target),false) THEN PERFORM pg_advisory_xact_lock_shared(hashtextextended('scm.project-admission:' || target,0)); END IF;
      IF EXISTS(SELECT 1 FROM scm.deletion_fences WHERE project_id=target AND operation_id IS NOT NULL)
        AND NOT (TG_OP='DELETE' AND scm.permitted_metadata_cleanup(target)) THEN
        RAISE EXCEPTION 'SCM sealed aliases cannot change' USING ERRCODE='55000';
      END IF;
    END LOOP;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scm_deletion_alias BEFORE INSERT OR UPDATE OR DELETE ON scm.resource_identity_aliases FOR EACH ROW EXECUTE FUNCTION scm.guard_deletion_alias();
