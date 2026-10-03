-- Preserve every original row/reference and admit each identical canonical project once per statement.
-- Original ownership, alias, closing and transaction admission functions remain unchanged.
CREATE OR REPLACE FUNCTION observability.guard_inserted_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry record;
BEGIN
  FOR entry IN
    WITH entries AS MATERIALIZED (
      SELECT row_number() OVER () AS entry_id, d.projects, d.entities
      FROM (SELECT DISTINCT observability.row_projects(to_jsonb(observation_new)) AS projects,
        observability.row_entities(TG_TABLE_NAME,to_jsonb(observation_new)) AS entities FROM observation_new) AS d
    ), refs AS MATERIALIZED (
      SELECT e.entry_id, ref->>'kind' AS kind, ref->>'id' AS id
      FROM entries e CROSS JOIN LATERAL jsonb_array_elements(e.entities) AS ref
    ), bindings AS (
      SELECT r.entry_id, d.project_id AS owner FROM refs r JOIN observability.deletion_entities d ON d.kind=r.kind AND d.entity_id=r.id
      UNION ALL SELECT r.entry_id, h.project_id FROM refs r JOIN observability.usage_heads h ON r.kind='task-key' AND h.task_key=r.id
      UNION ALL SELECT r.entry_id, h.project_id FROM refs r JOIN observability.usage_heads h ON r.kind='task' AND h.task_id=r.id
      UNION ALL SELECT r.entry_id, unnest(observability.row_projects(to_jsonb(u))) FROM refs r JOIN observability.usage_projections u ON r.kind='meter' AND u.meter_key=r.id
      UNION ALL SELECT r.entry_id, unnest(observability.row_projects(to_jsonb(v))) FROM refs r JOIN observability.execution_valuations v ON r.kind='meter' AND v.meter_key=r.id
      UNION ALL SELECT r.entry_id, unnest(observability.row_projects(to_jsonb(c))) FROM refs r JOIN observability.native_captures c ON r.kind='capture' AND c.id=r.id
      UNION ALL SELECT r.entry_id, unnest(observability.row_projects(to_jsonb(p))) FROM refs r JOIN observability.accepted_execution_prices p ON r.kind='execution' AND p.execution_id=r.id
    ), raw_owners AS MATERIALIZED (
      SELECT entry_id, owner FROM (
        SELECT e.entry_id, unnest(e.projects) AS owner FROM entries e
        UNION ALL SELECT entry_id, owner FROM bindings
      ) AS all_owners WHERE owner IS NOT NULL AND owner<>''
    ), canonical AS MATERIALIZED (
      SELECT owner, observability.canonical_project(owner) AS project FROM (SELECT DISTINCT owner FROM raw_owners) AS unique_owners
    ), owner_sets AS (
      SELECT e.entry_id, coalesce(array_agg(DISTINCT c.project ORDER BY c.project) FILTER (WHERE c.project IS NOT NULL),'{}'::text[]) AS projects
      FROM entries e LEFT JOIN raw_owners r ON r.entry_id=e.entry_id LEFT JOIN canonical c ON c.owner=r.owner GROUP BY e.entry_id
    ) SELECT DISTINCT projects FROM owner_sets
  LOOP
    IF cardinality(entry.projects)<>1 THEN RAISE EXCEPTION 'Observation content requires unambiguous original project ownership' USING ERRCODE='55000'; END IF;
    PERFORM observability.admit_project(entry.projects[1]);
  END LOOP;
  RETURN NULL;
END $$;
