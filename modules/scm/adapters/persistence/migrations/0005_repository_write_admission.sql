CREATE TABLE scm.deletion_fences(project_id text PRIMARY KEY,operation_id text,generation integer NOT NULL DEFAULT 0);
CREATE TABLE scm.deletion_identities(kind text NOT NULL CHECK(kind IN ('service','credential')),id text NOT NULL,service_id text NOT NULL,project_id text NOT NULL,PRIMARY KEY(kind,id));
INSERT INTO scm.deletion_identities SELECT 'service',service_id,service_id,project_id FROM scm.repository_bindings;
INSERT INTO scm.deletion_identities SELECT 'credential',c.id,c.service_id,b.project_id FROM scm.session_credentials c JOIN scm.repository_bindings b ON b.service_id=c.service_id;
-- These independently committed callback facts are not GitLab consumer or physical-stop proofs.
CREATE TABLE scm.deletion_work(
  id text PRIMARY KEY,project_id text NOT NULL,service_id text NOT NULL,kind text NOT NULL,
  remote_project_id text,backend_pid integer NOT NULL CHECK(backend_pid>0),callback_pid integer NOT NULL CHECK(callback_pid>0),callback_started_at timestamptz NOT NULL,
  process jsonb,state text NOT NULL DEFAULT 'running' CHECK(state IN ('running','exited')),
  result text CHECK(result IN ('succeeded','failed','interrupted')),effects jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(effects)='array'),
  exit_digest text CHECK(exit_digest IS NULL OR exit_digest~'^[a-f0-9]{64}$'),recovery_digest text CHECK(recovery_digest IS NULL OR recovery_digest~'^[a-f0-9]{64}$')
);

CREATE FUNCTION scm.actual_shared_admission(target text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('crewstation.shared_admission_key',true)='scm.project-admission:' || target
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND mode='ShareLock'
      AND pid=coalesce(nullif(current_setting('crewstation.shared_admission_pid',true),''),'0')::integer
      AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND objsubid=1
      AND classid::bigint=((hashtextextended('scm.project-admission:' || target,0) >> 32) & 4294967295)
      AND objid::bigint=(hashtextextended('scm.project-admission:' || target,0) & 4294967295))
$$;
CREATE FUNCTION scm.guard_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'SCM original ownership is immutable' USING ERRCODE='55000'; END IF;
  IF NOT coalesce(scm.actual_shared_admission(NEW.project_id),false) THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('scm.project-admission:' || NEW.project_id,0));
  END IF;
  IF EXISTS(SELECT 1 FROM scm.deletion_fences WHERE project_id=NEW.project_id AND operation_id IS NOT NULL) THEN
    RAISE EXCEPTION 'SCM project is sealed' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scm_original_identity BEFORE INSERT OR UPDATE OR DELETE ON scm.deletion_identities FOR EACH ROW EXECUTE FUNCTION scm.guard_identity();

CREATE FUNCTION scm.guard_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE service_key text;target text;original_project text;old_target text;entity_key text;
BEGIN
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
CREATE TRIGGER scm_binding_admission BEFORE INSERT OR UPDATE OR DELETE ON scm.repository_bindings FOR EACH ROW EXECUTE FUNCTION scm.guard_content();
CREATE TRIGGER scm_credential_admission BEFORE INSERT OR UPDATE OR DELETE ON scm.session_credentials FOR EACH ROW EXECUTE FUNCTION scm.guard_content();

CREATE FUNCTION scm.guard_callback_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE journal boolean;exiting boolean;
BEGIN
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
CREATE TRIGGER scm_callback_work_admission BEFORE INSERT OR UPDATE OR DELETE ON scm.deletion_work FOR EACH ROW EXECUTE FUNCTION scm.guard_callback_work();
