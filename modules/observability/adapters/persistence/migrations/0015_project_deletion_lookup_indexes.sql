-- Keep row admission proportional to the referenced identities, including 10,001 native steps.
CREATE INDEX observability_usage_head_task ON observability.usage_heads(task_id);
CREATE FUNCTION observability.entity_keys(entities jsonb, requested text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(value->>'id'),'{}'::text[]) FROM jsonb_array_elements(entities) AS value WHERE value->>'kind'=requested
$$;

-- The transition table validates every inserted row, grouping only identical ownership references.
-- Acquiring admission after INSERT is safe: a concurrent seal makes this statement roll back before commit.
-- Normal repository transactions already hold admission before their first row lock.
CREATE FUNCTION observability.guard_inserted_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry record; owners text[];
BEGIN
  FOR entry IN SELECT DISTINCT observability.row_projects(to_jsonb(observation_new)) AS projects,
    observability.row_entities(TG_TABLE_NAME,to_jsonb(observation_new)) AS entities FROM observation_new LOOP
    SELECT coalesce(array_agg(DISTINCT observability.canonical_project(value)),'{}'::text[]) INTO owners
      FROM unnest(entry.projects || observability.related_projects(entry.entities)) AS value;
    IF cardinality(owners)<>1 THEN RAISE EXCEPTION 'Observation content requires unambiguous original project ownership' USING ERRCODE='55000'; END IF;
    PERFORM observability.admit_project(owners[1]);
  END LOOP;
  RETURN NULL;
END $$;
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['accepted_execution_prices','alerts','cost_visibility','cost_visibility_receipts','development_model_evidence',
    'execution_valuation_receipts','execution_valuations','native_baselines','native_capture_history','native_captures','native_repairs','native_steps',
    'usage_changes','usage_events','usage_evidence','usage_heads','usage_pages','usage_projections','usage_snapshots','usage_sources'] LOOP
    EXECUTE format('DROP TRIGGER observation_content_guard ON observability.%I',name);
    EXECUTE format('CREATE TRIGGER observation_content_guard BEFORE UPDATE OR DELETE ON observability.%I FOR EACH ROW EXECUTE FUNCTION observability.guard_content()',name);
    EXECUTE format('CREATE TRIGGER observation_insert_guard AFTER INSERT ON observability.%I REFERENCING NEW TABLE AS observation_new FOR EACH STATEMENT EXECUTE FUNCTION observability.guard_inserted_content()',name);
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION observability.related_projects(entities jsonb) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(DISTINCT owner ORDER BY owner),'{}'::text[]) FROM (
    SELECT project_id AS owner FROM observability.deletion_entities WHERE (kind,entity_id) IN (SELECT value->>'kind',value->>'id' FROM jsonb_array_elements(entities) AS value)
    UNION SELECT project_id FROM observability.usage_heads WHERE task_key=ANY(observability.entity_keys(entities,'task-key')) OR task_id=ANY(observability.entity_keys(entities,'task'))
    UNION SELECT unnest(observability.row_projects(to_jsonb(usage_projections))) FROM observability.usage_projections WHERE meter_key=ANY(observability.entity_keys(entities,'meter'))
    UNION SELECT unnest(observability.row_projects(to_jsonb(execution_valuations))) FROM observability.execution_valuations WHERE meter_key=ANY(observability.entity_keys(entities,'meter'))
    UNION SELECT unnest(observability.row_projects(to_jsonb(native_captures))) FROM observability.native_captures WHERE id=ANY(observability.entity_keys(entities,'capture'))
    UNION SELECT unnest(observability.row_projects(to_jsonb(accepted_execution_prices))) FROM observability.accepted_execution_prices WHERE execution_id=ANY(observability.entity_keys(entities,'execution'))
  ) AS owners WHERE owner IS NOT NULL AND owner<>''
$$;
