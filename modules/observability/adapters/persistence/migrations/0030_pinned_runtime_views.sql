-- RFC-034: shared numerical versions, immutable period membership and lazy detail pages.
ALTER TABLE observability.runtime_task_work ADD COLUMN project_id text;
CREATE TABLE observability.runtime_task_metadata(task_id text PRIMARY KEY,project_id text NOT NULL,source_kind text NOT NULL,created_at timestamptz NOT NULL,document jsonb NOT NULL);
CREATE INDEX runtime_metadata_window ON observability.runtime_task_metadata(project_id,created_at DESC,task_id);
CREATE INDEX runtime_metadata_system_window ON observability.runtime_task_metadata(created_at DESC,task_id);
CREATE TABLE observability.runtime_lazy_reports(id text PRIMARY KEY,request_key text UNIQUE NOT NULL,owner text NOT NULL,request jsonb NOT NULL,report jsonb NOT NULL,state text NOT NULL CHECK(state IN('building','ready','not-ready')),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE observability.runtime_report_task_refs(report_id text NOT NULL REFERENCES observability.runtime_lazy_reports(id) ON DELETE CASCADE,ordinal bigint NOT NULL,task_id text NOT NULL,version text,project_id text NOT NULL,document jsonb NOT NULL,PRIMARY KEY(report_id,ordinal),UNIQUE(report_id,task_id));
CREATE INDEX runtime_pinned_versions ON observability.runtime_report_task_refs(task_id,version);
CREATE INDEX runtime_cached_public_sections ON observability.runtime_task_cache_rows(task_id,version,role,(document->>'section'),(document->>'parent'),key);
CREATE INDEX runtime_cached_public_identity ON observability.runtime_task_cache_rows(task_id,version,role,(document->>'section'),(document->>'parent'),(document->>'key'));
CREATE FUNCTION observability.guard_runtime_view_original() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state<>'building' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'published runtime view is immutable';END IF;RETURN NEW;
END $$;
CREATE TRIGGER runtime_view_original BEFORE UPDATE ON observability.runtime_lazy_reports FOR EACH ROW EXECUTE FUNCTION observability.guard_runtime_view_original();
CREATE FUNCTION observability.dirty_runtime_task_project(key text,project text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO observability.runtime_task_work(key,project_id) SELECT key,project WHERE key IS NOT NULL AND length(key)>0 ON CONFLICT(key) DO UPDATE SET revision=nextval('observability.runtime_task_change_sequence'),project_id=coalesce("excluded"."project_id",observability.runtime_task_work.project_id)
$$;
CREATE OR REPLACE FUNCTION observability.original_runtime_task_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d jsonb;i jsonb;target text;project text;
BEGIN
 FOREACH d IN ARRAY CASE WHEN TG_OP='INSERT' THEN ARRAY[to_jsonb(NEW)] WHEN TG_OP='DELETE' THEN ARRAY[to_jsonb(OLD)] ELSE ARRAY[to_jsonb(OLD),to_jsonb(NEW)] END LOOP
  i:=coalesce(d->'document'->'identity',d->'document'->'meter'->'identity',d->'summary'->'identity',d->'document'->'registration'->'identity');project:=coalesce(i->>'projectId',d->>'project_id',d->'prepared'->'intent'->'identity'->>'projectId');
  target:=CASE WHEN TG_TABLE_SCHEMA='project' THEN 'project:'||(d->>'id') WHEN TG_TABLE_SCHEMA='agent_runtime' THEN 'global:profiles' WHEN TG_TABLE_NAME='cost_visibility' THEN 'project:'||(d->>'project_id')
   WHEN TG_TABLE_NAME IN('development_agent_usage','agent_starts','native_terminal_starts') THEN d->>'execution_task_id'
   WHEN TG_TABLE_NAME='observation_activity_history' THEN d->>'source_task_id'
   WHEN TG_TABLE_NAME IN('observation_lifecycle','environments') THEN coalesce(d->>'task_id',d->>'id')
   WHEN TG_TABLE_NAME='execution_operations' THEN coalesce(d->'intent'->'task'->>'id',d->'intent'->>'taskId') WHEN TG_TABLE_NAME='tasks' THEN d->>'id'
   WHEN i->>'sourceKind' IN('development-agent','development-cli') THEN i->>'executionId' ELSE coalesce(i->>'taskId',d->>'task_id') END;
  IF target IS NOT NULL THEN
   IF TG_TABLE_NAME IN('usage_projections','execution_valuations','usage_model_evidence') AND TG_OP<>'DELETE' THEN PERFORM observability.dirty_runtime_self_record(target,project,d->>'meter_key');
   ELSE PERFORM observability.dirty_runtime_task_project(target,project);END IF;
  END IF;
 END LOOP;RETURN NULL;
END $$;
-- A derived view remains behind the same explicit project deletion barrier as the existing reports.
