CREATE TABLE identity.deletion_fences (
  project_id text PRIMARY KEY, project_slug text NOT NULL DEFAULT '', operation_id text,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0), confirmed_revision text
);
CREATE INDEX identity_deletion_slug_idx ON identity.deletion_fences(project_slug) WHERE operation_id IS NOT NULL;
CREATE FUNCTION identity.guard_project_forwarding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id text; target_ids text[]; deletion_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN target_ids := ARRAY[OLD.project_id, NEW.project_id];
  ELSIF TG_OP = 'DELETE' THEN target_ids := ARRAY[OLD.project_id];
  ELSE target_ids := ARRAY[NEW.project_id]; END IF;
  FOR target_id IN SELECT DISTINCT value FROM unnest(target_ids) value WHERE value IS NOT NULL ORDER BY value LOOP
    INSERT INTO identity.deletion_fences(project_id) VALUES (target_id) ON CONFLICT DO NOTHING;
    SELECT operation_id INTO deletion_id FROM identity.deletion_fences WHERE project_id = target_id FOR UPDATE;
    IF deletion_id IS NOT NULL AND (TG_OP <> 'DELETE' OR deletion_id IS DISTINCT FROM current_setting('crewstation.identity_deletion', true)) THEN
      RAISE EXCEPTION 'project identity is sealed for deletion' USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER identity_project_forwarding_fence BEFORE INSERT OR UPDATE OR DELETE ON identity.identity_forwarding
  FOR EACH ROW EXECUTE FUNCTION identity.guard_project_forwarding();
