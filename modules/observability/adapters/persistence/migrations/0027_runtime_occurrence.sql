CREATE TABLE observability.runtime_occurrence(task_id text NOT NULL,project_id text NOT NULL,source_kind text NOT NULL,key text NOT NULL,execution_key text NOT NULL,occurred_at timestamptz,document jsonb NOT NULL,PRIMARY KEY(task_id,key));
CREATE INDEX runtime_occurrence_window ON observability.runtime_occurrence(project_id,occurred_at,source_kind,task_id);
CREATE INDEX runtime_occurrence_system_window ON observability.runtime_occurrence(occurred_at,source_kind,task_id);
CREATE FUNCTION observability.guard_runtime_occurrence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE content jsonb; entities jsonb; owners text[]; previous text[]; project text; fence observability.deletion_fences;
BEGIN
  content:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF content->>'source_kind'='platform-test' THEN
    IF content->>'project_id' IS DISTINCT FROM '' OR NOT EXISTS(
      SELECT 1 FROM observability.platform_usage_admissions a WHERE 'platform-test:'||a.test_id=content->>'task_id'
    ) THEN RAISE EXCEPTION 'Platform occurrence requires its original platform admission' USING ERRCODE='55000'; END IF;
    IF TG_OP='UPDATE' AND (to_jsonb(OLD)->>'source_kind' IS DISTINCT FROM content->>'source_kind'
      OR to_jsonb(OLD)->>'project_id' IS DISTINCT FROM content->>'project_id'
      OR to_jsonb(OLD)->>'task_id' IS DISTINCT FROM content->>'task_id') THEN
      RAISE EXCEPTION 'Platform occurrence original ownership cannot be transferred' USING ERRCODE='55000';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  entities:=observability.row_entities(TG_TABLE_NAME,content);
  SELECT coalesce(array_agg(DISTINCT observability.canonical_project(value) ORDER BY observability.canonical_project(value)),'{}'::text[]) INTO owners
    FROM unnest(observability.row_projects(content) || observability.related_projects(entities)) AS value;
  IF cardinality(owners)<>1 THEN RAISE EXCEPTION 'Observation content requires unambiguous original project ownership' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' THEN
    SELECT coalesce(array_agg(DISTINCT observability.canonical_project(value)),'{}'::text[]) INTO previous
      FROM unnest(observability.row_projects(to_jsonb(OLD)) || observability.related_projects(observability.row_entities(TG_TABLE_NAME,to_jsonb(OLD)))) AS value;
    IF previous IS DISTINCT FROM owners OR TG_TABLE_NAME='usage_heads' AND (to_jsonb(OLD)->>'task_key' IS DISTINCT FROM content->>'task_key' OR to_jsonb(OLD)->>'project_id' IS DISTINCT FROM content->>'project_id' OR to_jsonb(OLD)->>'task_id' IS DISTINCT FROM content->>'task_id') THEN
      RAISE EXCEPTION 'Observation original project ownership cannot be transferred' USING ERRCODE='55000';
    END IF;
  END IF;
  project:=owners[1]; SELECT * INTO fence FROM observability.deletion_fences WHERE project_id=project;
  IF fence.project_id IS NOT NULL AND TG_OP='DELETE' AND fence.verified AND fence.phase_index=4
    AND coalesce(observability.deletion_permission(project,fence.operation_id,fence.generation,'metadata'),false) THEN RETURN OLD; END IF;
  PERFORM observability.admit_project(project);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER observation_content_guard BEFORE INSERT OR UPDATE OR DELETE ON observability.runtime_occurrence FOR EACH ROW EXECUTE FUNCTION observability.guard_runtime_occurrence();

-- Shared qualified hourly sums serve every requested period. Task membership supports exact correction and unique execution counts.
CREATE TABLE observability.runtime_occurrence_task_hours(task_id text NOT NULL,project_id text NOT NULL,source_kind text NOT NULL,hour text NOT NULL,document jsonb NOT NULL,PRIMARY KEY(task_id,hour));
CREATE INDEX runtime_occurrence_task_hour_range ON observability.runtime_occurrence_task_hours(project_id,hour,source_kind,task_id);
CREATE TABLE observability.runtime_occurrence_hours(LIKE observability.runtime_daily_aggregates INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE observability.runtime_occurrence_hours ALTER COLUMN day TYPE text USING day::text;
ALTER TABLE observability.runtime_occurrence_hours ADD PRIMARY KEY(scope,day,source_kind);

CREATE TABLE observability.runtime_occurrence_hour_executions(task_id text NOT NULL,project_id text NOT NULL,source_kind text NOT NULL,hour text NOT NULL,execution_key text NOT NULL,PRIMARY KEY(task_id,hour,execution_key));
CREATE INDEX runtime_occurrence_hour_executions_range ON observability.runtime_occurrence_hour_executions(project_id,hour,source_kind,execution_key);
