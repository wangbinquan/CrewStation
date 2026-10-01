-- Minimum original ownership and actual callback facts, without passwords, SQL text or business contents.
CREATE TABLE data_control.deletion_fences(project_id text PRIMARY KEY,operation_id text,generation integer NOT NULL DEFAULT 0,confirmed_revision text,scope_verified boolean NOT NULL DEFAULT false);
CREATE TABLE data_control.deletion_entities(resource_id text PRIMARY KEY,project_id text NOT NULL);
CREATE TABLE data_control.deletion_work(
  work_id text PRIMARY KEY,resource_id text NOT NULL,project_id text NOT NULL,backend_pid integer NOT NULL,names jsonb NOT NULL,
  state text NOT NULL DEFAULT 'running' CHECK(state IN ('running','finished')),
  native_pid integer,native_started text,source_identity text,
  pod_uid text,container_id text,node_uid text,node_name text,proof_digest text,
  CHECK((pod_uid IS NULL AND container_id IS NULL AND node_uid IS NULL AND node_name IS NULL) OR (pod_uid IS NOT NULL AND container_id IS NOT NULL AND node_uid IS NOT NULL AND node_name IS NOT NULL)),
  CHECK(proof_digest IS NULL OR proof_digest ~ '^[a-f0-9]{64}$')
);
CREATE INDEX data_control_original_work ON data_control.deletion_work(project_id,state);
CREATE FUNCTION data_control.actual_admission(target text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND mode='ShareLock'
    AND pid IN(coalesce(nullif(current_setting('crewstation.shared_admission_pid',true),''),'0')::integer,coalesce(nullif(current_setting('crewstation.data_control_admission_pid',true),''),'0')::integer)
    AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND objsubid=1
    AND classid::bigint=((hashtextextended('data-control.project-admission:' || target,0)>>32)&4294967295)
    AND objid::bigint=(hashtextextended('data-control.project-admission:' || target,0)&4294967295))
$$;
CREATE FUNCTION data_control.guard_entity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'original database resource ownership is immutable' USING ERRCODE='55000'; END IF;
  IF NOT data_control.actual_admission(NEW.project_id) OR EXISTS(SELECT 1 FROM data_control.deletion_fences WHERE project_id=NEW.project_id AND operation_id IS NOT NULL) THEN
    RAISE EXCEPTION 'database project admission is closed or unprotected' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_control_entity_guard BEFORE INSERT OR UPDATE OR DELETE ON data_control.deletion_entities FOR EACH ROW EXECUTE FUNCTION data_control.guard_entity();
CREATE FUNCTION data_control.guard_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE marker text;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'running' OR NEW.native_pid IS NOT NULL OR NEW.native_started IS NOT NULL OR NEW.source_identity IS NOT NULL OR NEW.proof_digest IS NOT NULL OR
      NEW.backend_pid<>coalesce(nullif(current_setting('crewstation.shared_admission_pid',true),''),'0')::integer OR
      jsonb_typeof(NEW.names)<>'array' OR jsonb_array_length(NEW.names)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.names) AS name WHERE name !~ '^cs_[a-z0-9_]{1,60}$') OR
      NOT data_control.actual_admission(NEW.project_id) OR EXISTS(SELECT 1 FROM data_control.deletion_fences WHERE project_id=NEW.project_id AND operation_id IS NOT NULL) OR
      NOT EXISTS(SELECT 1 FROM data_control.deletion_entities WHERE resource_id=NEW.resource_id AND project_id=NEW.project_id) THEN
      RAISE EXCEPTION 'native work has no admitted original resource' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.state='running' THEN RAISE EXCEPTION 'original native work has not exited' USING ERRCODE='55000'; END IF;
    RETURN OLD;
  END IF;
  IF (NEW.work_id,NEW.resource_id,NEW.project_id,NEW.backend_pid,NEW.names,NEW.pod_uid,NEW.container_id,NEW.node_uid,NEW.node_name)
      IS DISTINCT FROM (OLD.work_id,OLD.resource_id,OLD.project_id,OLD.backend_pid,OLD.names,OLD.pod_uid,OLD.container_id,OLD.node_uid,OLD.node_name) THEN
    RAISE EXCEPTION 'original native work identity is immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.native_pid IS NOT NULL AND (NEW.native_pid,NEW.native_started,NEW.source_identity) IS DISTINCT FROM (OLD.native_pid,OLD.native_started,OLD.source_identity) THEN
    RAISE EXCEPTION 'original native session cannot be replaced' USING ERRCODE='55000';
  END IF;
  IF OLD.native_pid IS NULL AND NEW.native_pid IS NOT NULL AND
    (OLD.state<>'running' OR NEW.native_pid<=0 OR NEW.native_started IS NULL OR NEW.source_identity IS NULL OR NEW.source_identity !~ '^[a-f0-9]{64}$' OR NOT data_control.actual_admission(OLD.project_id)) THEN
    RAISE EXCEPTION 'native session binding lacks original admission' USING ERRCODE='55000';
  END IF;
  marker:=current_setting('crewstation.data_control_work_exit',true);
  IF (NEW.state,NEW.proof_digest) IS DISTINCT FROM (OLD.state,OLD.proof_digest) AND (OLD.state<>'running' OR NEW.state<>'finished' OR marker IS DISTINCT FROM OLD.work_id) THEN
    RAISE EXCEPTION 'original native callback has no actual exit receipt' USING ERRCODE='55000';
  END IF;
  IF NEW.proof_digest IS NOT NULL AND OLD.pod_uid IS NULL THEN RAISE EXCEPTION 'native stop receipt lacks original process' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_control_work_guard BEFORE INSERT OR UPDATE OR DELETE ON data_control.deletion_work FOR EACH ROW EXECUTE FUNCTION data_control.guard_work();
CREATE FUNCTION data_control.guard_credential() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text; marker text;
BEGIN
  SELECT project_id INTO target FROM data_control.deletion_entities WHERE resource_id=CASE WHEN TG_OP='DELETE' THEN OLD.resource_id ELSE NEW.resource_id END;
  IF target IS NULL THEN RAISE EXCEPTION 'database credential has no original project owner' USING ERRCODE='55000'; END IF;
  SELECT operation_id INTO marker FROM data_control.deletion_fences WHERE project_id=target;
  IF marker IS NOT NULL THEN
    IF TG_OP<>'DELETE' OR current_setting('crewstation.data_control_deletion',true) IS DISTINCT FROM marker THEN RAISE EXCEPTION 'database credentials are retired' USING ERRCODE='55000'; END IF;
  ELSIF NOT data_control.actual_admission(target) THEN RAISE EXCEPTION 'database credential lacks actual shared admission' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' AND (NEW.resource_id,NEW.role) IS DISTINCT FROM (OLD.resource_id,OLD.role) THEN RAISE EXCEPTION 'original database credential identity is immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_control_credential_guard BEFORE INSERT OR UPDATE OR DELETE ON data_control.credentials FOR EACH ROW EXECUTE FUNCTION data_control.guard_credential();
