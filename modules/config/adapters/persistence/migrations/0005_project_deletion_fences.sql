-- 只保留闭准入所需身份；不保存配置名、值或 Secret 密文。
CREATE TABLE config.deletion_fences (
  project_id text PRIMARY KEY, operation_id text, generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0), confirmed_revision text
);
CREATE FUNCTION config.guard_project_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id text; target_ids text[]; deletion_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN target_ids := ARRAY[OLD.project_id, NEW.project_id];
  ELSIF TG_OP = 'DELETE' THEN target_ids := ARRAY[OLD.project_id];
  ELSE target_ids := ARRAY[NEW.project_id]; END IF;
  FOR target_id IN SELECT DISTINCT value FROM unnest(target_ids) value ORDER BY value LOOP
    INSERT INTO config.deletion_fences(project_id) VALUES (target_id) ON CONFLICT DO NOTHING;
    SELECT operation_id INTO deletion_id FROM config.deletion_fences WHERE project_id = target_id FOR UPDATE;
    IF deletion_id IS NOT NULL AND (TG_OP <> 'DELETE' OR deletion_id IS DISTINCT FROM current_setting('crewstation.config_deletion', true)) THEN
      RAISE EXCEPTION 'project configuration is sealed for deletion' USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$
DECLARE content_table text;
BEGIN
  FOREACH content_table IN ARRAY ARRAY['definitions','items','value_sets','versions','version_entries'] LOOP
    EXECUTE format('CREATE TRIGGER config_project_content_fence BEFORE INSERT OR UPDATE OR DELETE ON config.%I FOR EACH ROW EXECUTE FUNCTION config.guard_project_content()', content_table);
  END LOOP;
END $$;
