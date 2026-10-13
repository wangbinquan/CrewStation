-- Roles are captured at their original state transition, never relabeled from current active slots.
CREATE TABLE release.observation_roles(sequence bigserial PRIMARY KEY,service_id text NOT NULL,at timestamptz NOT NULL,active text NOT NULL,blue_release text,green_release text);
CREATE INDEX observation_roles_service ON release.observation_roles(service_id,sequence);
CREATE FUNCTION release.retain_observation_roles() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.active IS DISTINCT FROM OLD.active OR NEW.blue->>'releaseId' IS DISTINCT FROM OLD.blue->>'releaseId' OR NEW.green->>'releaseId' IS DISTINCT FROM OLD.green->>'releaseId' OR NEW.blue->>'state' IS DISTINCT FROM OLD.blue->>'state' OR NEW.green->>'state' IS DISTINCT FROM OLD.green->>'state' THEN
 INSERT INTO release.observation_roles(service_id,at,active,blue_release,green_release) VALUES(NEW.service_id,NEW.updated_at,NEW.active,CASE WHEN NEW.blue->>'state'='ready' THEN NEW.blue->>'releaseId' END,CASE WHEN NEW.green->>'state'='ready' THEN NEW.green->>'releaseId' END);
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER retain_observation_roles AFTER INSERT OR UPDATE ON release.service_slots FOR EACH ROW EXECUTE FUNCTION release.retain_observation_roles();
-- The first known point is installation time; no earlier role is invented.
INSERT INTO release.observation_roles(service_id,at,active,blue_release,green_release) SELECT service_id,clock_timestamp(),active,CASE WHEN blue->>'state'='ready' THEN blue->>'releaseId' END,CASE WHEN green->>'state'='ready' THEN green->>'releaseId' END FROM release.service_slots;

CREATE OR REPLACE FUNCTION release.deletion_key(kind text,body jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN kind='observation_roles' THEN body->>'sequence' WHEN kind='replica_overrides' THEN release.deletion_json_text(jsonb_build_array(body->'service_id',body->'physical')) ELSE COALESCE(body->>'id',body->>'service_id') END
$$;
CREATE TRIGGER release_content_guard BEFORE INSERT OR UPDATE OR DELETE ON release.observation_roles FOR EACH ROW EXECUTE FUNCTION release.guard_project_content();
CREATE TRIGGER release_project_truncate_guard BEFORE TRUNCATE ON release.observation_roles FOR EACH STATEMENT EXECUTE FUNCTION release.reject_content_truncate();
