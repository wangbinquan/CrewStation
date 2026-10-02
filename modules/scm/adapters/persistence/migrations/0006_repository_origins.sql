CREATE TABLE scm.deletion_repository_origins(project_id text NOT NULL,service_id text NOT NULL,remote_project_id text NOT NULL,path_with_namespace text NOT NULL,remote_created_at text,source text NOT NULL CHECK(source IN ('legacy-binding','callback-result')),work_id text,PRIMARY KEY(service_id,remote_project_id));
-- Legacy rows keep the original numeric binding but have no invented remote timestamp or callback.
INSERT INTO scm.deletion_repository_origins SELECT project_id,service_id,remote_project_id,path_with_namespace,NULL,'legacy-binding',NULL FROM scm.repository_bindings;
CREATE FUNCTION scm.guard_repository_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE callback scm.deletion_work;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'SCM repository origin is immutable' USING ERRCODE='55000'; END IF;
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
CREATE TRIGGER scm_repository_origin BEFORE INSERT OR UPDATE OR DELETE ON scm.deletion_repository_origins FOR EACH ROW EXECUTE FUNCTION scm.guard_repository_origin();
CREATE FUNCTION scm.record_binding_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO scm.deletion_repository_origins VALUES(NEW.project_id,NEW.service_id,NEW.remote_project_id,NEW.path_with_namespace,NULL,'legacy-binding',NULL) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER scm_binding_origin AFTER INSERT OR UPDATE ON scm.repository_bindings FOR EACH ROW EXECUTE FUNCTION scm.record_binding_origin();

CREATE FUNCTION scm.guard_credential_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.remote_token_id IS DISTINCT FROM NEW.remote_token_id OR OLD.token_hash IS DISTINCT FROM NEW.token_hash
    OR OLD.expires_at IS DISTINCT FROM NEW.expires_at OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'SCM credential original remote identity is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scm_credential_identity BEFORE UPDATE ON scm.session_credentials FOR EACH ROW EXECUTE FUNCTION scm.guard_credential_identity();
