-- Derived task allocation is independent of requested report periods. Original I/U/D commit dirty ownership atomically.
CREATE SEQUENCE observability.runtime_task_change_sequence;
CREATE TABLE observability.runtime_projection_head(singleton boolean PRIMARY KEY CHECK(singleton),revision numeric NOT NULL DEFAULT 0,as_of text);
INSERT INTO observability.runtime_projection_head(singleton) VALUES(true);
CREATE TABLE observability.runtime_task_publications(revision bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY);
CREATE TABLE observability.runtime_task_work(key text PRIMARY KEY,revision bigint NOT NULL DEFAULT nextval('observability.runtime_task_change_sequence'),polled_at timestamptz NOT NULL DEFAULT '-infinity');
CREATE TABLE observability.runtime_task_cache(task_id text PRIMARY KEY,project_id text NOT NULL,source_kind text NOT NULL,created_at timestamptz NOT NULL,source_revision text NOT NULL,version text NOT NULL,document jsonb NOT NULL);
CREATE INDEX runtime_task_cache_window ON observability.runtime_task_cache(project_id,created_at,task_id);
CREATE TABLE observability.runtime_task_cache_rows(task_id text NOT NULL,version text NOT NULL,role text NOT NULL,key text NOT NULL,document jsonb NOT NULL,PRIMARY KEY(task_id,version,role,key));
CREATE TABLE observability.runtime_task_bootstrap(singleton boolean PRIMARY KEY CHECK(singleton),done boolean NOT NULL DEFAULT false);
INSERT INTO observability.runtime_task_bootstrap(singleton) VALUES(true);
CREATE FUNCTION observability.dirty_runtime_task(key text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO observability.runtime_task_work(key) SELECT key WHERE key IS NOT NULL AND length(key)>0
 ON CONFLICT(key) DO UPDATE SET revision=nextval('observability.runtime_task_change_sequence')
$$;
CREATE FUNCTION observability.original_runtime_task_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d jsonb;i jsonb;target text;
BEGIN
 FOREACH d IN ARRAY CASE WHEN TG_OP='INSERT' THEN ARRAY[to_jsonb(NEW)] WHEN TG_OP='DELETE' THEN ARRAY[to_jsonb(OLD)] ELSE ARRAY[to_jsonb(OLD),to_jsonb(NEW)] END LOOP
  i:=coalesce(d->'document'->'identity',d->'document'->'meter'->'identity',d->'summary'->'identity',d->'document'->'registration'->'identity');
  target:=CASE
   WHEN TG_TABLE_SCHEMA='project' THEN 'project:'||(d->>'id')
   WHEN TG_TABLE_SCHEMA='agent_runtime' THEN 'global:profiles'
   WHEN TG_TABLE_NAME='cost_visibility' THEN 'project:'||(d->>'project_id')
   WHEN TG_TABLE_NAME='development_agent_usage' OR TG_TABLE_NAME='agent_starts' OR TG_TABLE_NAME='native_terminal_starts' THEN d->>'execution_task_id'
   WHEN TG_TABLE_NAME='observation_activity_history' THEN d->>'source_task_id'
   WHEN TG_TABLE_NAME='observation_lifecycle' THEN d->>'task_id'
   WHEN TG_TABLE_NAME='execution_operations' THEN coalesce(d->'intent'->'task'->>'id',d->'intent'->>'taskId')
   WHEN TG_TABLE_NAME='tasks' THEN d->>'id'
   WHEN i->>'sourceKind' IN ('development-agent','development-cli') THEN i->>'executionId'
   ELSE coalesce(i->>'taskId',d->>'task_id') END;
  IF target IS NOT NULL THEN PERFORM observability.dirty_runtime_task(target); END IF;
 END LOOP;
 RETURN NULL;
END $$;
DO $$ DECLARE source text;BEGIN
 FOREACH source IN ARRAY ARRAY['task_runtime.observation_lifecycle','task_runtime.environments','dev_session.observation_activity_history','business_task.tasks','business_task.subtasks','business_task.execution_operations','business_task.execution_subtasks','business_task.execution_task_states','business_task.execution_logs','dev_session.development_agent_usage','dev_session.agent_starts','dev_session.native_terminal_starts','project.projects','agent_runtime.profiles','observability.usage_projections','observability.execution_valuations','observability.native_captures','observability.native_steps','observability.native_baselines','observability.cost_visibility','observability.development_model_evidence','observability.development_native_passes'] LOOP
  IF to_regclass(source) IS NOT NULL THEN EXECUTE format('CREATE TRIGGER incremental_runtime_task_change AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION observability.original_runtime_task_change()',source);END IF;
 END LOOP;
END $$;

CREATE TABLE observability.runtime_daily_aggregates(scope text NOT NULL,day date NOT NULL,source_kind text NOT NULL,tasks numeric NOT NULL DEFAULT 0 CHECK(tasks>=0),input numeric NOT NULL DEFAULT 0 CHECK(input>=0),cache_read numeric NOT NULL DEFAULT 0 CHECK(cache_read>=0),cache_write numeric NOT NULL DEFAULT 0 CHECK(cache_write>=0),output numeric NOT NULL DEFAULT 0 CHECK(output>=0),input_records numeric NOT NULL DEFAULT 0 CHECK(input_records>=0),cache_read_records numeric NOT NULL DEFAULT 0 CHECK(cache_read_records>=0),cache_write_records numeric NOT NULL DEFAULT 0 CHECK(cache_write_records>=0),output_records numeric NOT NULL DEFAULT 0 CHECK(output_records>=0),executions numeric NOT NULL DEFAULT 0 CHECK(executions>=0),observed numeric NOT NULL DEFAULT 0 CHECK(observed>=0),records numeric NOT NULL DEFAULT 0 CHECK(records>=0),priced_records numeric NOT NULL DEFAULT 0 CHECK(priced_records>=0),partial_records numeric NOT NULL DEFAULT 0 CHECK(partial_records>=0),picos numeric NOT NULL DEFAULT 0 CHECK(picos>=0),unpriced_tasks numeric NOT NULL DEFAULT 0 CHECK(unpriced_tasks>=0),gaps jsonb NOT NULL DEFAULT '{}'::jsonb,PRIMARY KEY(scope,day,source_kind));
