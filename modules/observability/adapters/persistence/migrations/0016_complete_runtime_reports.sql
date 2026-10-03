-- RFC-034: derived immutable full reports; no observation/source authority in these tables.
CREATE TABLE observability.runtime_report_clock (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision numeric NOT NULL DEFAULT 0 CHECK(revision>=0));
INSERT INTO observability.runtime_report_clock(singleton) VALUES(true);
CREATE FUNCTION observability.advance_runtime_report_clock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE observability.runtime_report_clock SET revision=revision+1 WHERE singleton=true; RETURN NULL; END $$;
CREATE TABLE observability.runtime_reports(id text PRIMARY KEY,request_key text NOT NULL UNIQUE,owner text NOT NULL,request jsonb NOT NULL,state text NOT NULL CHECK(state IN ('building','not-ready','failed','ready')),report jsonb NOT NULL,manifest jsonb,lease_until timestamptz NOT NULL DEFAULT clock_timestamp()+interval '45 seconds',created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE observability.runtime_report_pages(report_id text NOT NULL REFERENCES observability.runtime_reports(id) ON DELETE CASCADE,ordinal numeric NOT NULL CHECK(ordinal>=0),previous_digest text NOT NULL,digest text NOT NULL,items_count integer NOT NULL CHECK(items_count BETWEEN 1 AND 500),PRIMARY KEY(report_id,ordinal));
CREATE TABLE observability.runtime_report_rows(report_id text NOT NULL REFERENCES observability.runtime_reports(id) ON DELETE CASCADE,ordinal numeric NOT NULL,section text NOT NULL,parent text NOT NULL,key text NOT NULL,document jsonb NOT NULL,PRIMARY KEY(report_id,ordinal));
CREATE INDEX runtime_report_rows_page ON observability.runtime_report_rows(report_id,section,parent,ordinal);
CREATE UNIQUE INDEX runtime_report_rows_identity ON observability.runtime_report_rows(report_id,section,parent,key);
CREATE TABLE observability.runtime_report_counts(report_id text NOT NULL REFERENCES observability.runtime_reports(id) ON DELETE CASCADE,section text NOT NULL,parent text NOT NULL,total numeric NOT NULL CHECK(total>=0),PRIMARY KEY(report_id,section,parent));
CREATE TABLE observability.runtime_report_receipts(report_id text NOT NULL REFERENCES observability.runtime_reports(id) ON DELETE CASCADE,key text NOT NULL,document jsonb NOT NULL,PRIMARY KEY(report_id,key));

-- The clock advances with committed original facts, usages, captures, valuations and names, including deletes.
DO $$ DECLARE source text; BEGIN
 FOREACH source IN ARRAY ARRAY['business_task.tasks','business_task.subtasks','business_task.execution_operations','business_task.execution_subtasks','business_task.execution_task_states','business_task.execution_logs','dev_session.development_agent_usage','dev_session.agent_starts','project.projects','agent_runtime.profiles','observability.usage_projections','observability.execution_valuations','observability.native_captures','observability.native_steps','observability.native_baselines','observability.cost_visibility','observability.usage_heads','observability.development_model_evidence'] LOOP
  IF to_regclass(source) IS NOT NULL THEN EXECUTE format('CREATE TRIGGER runtime_report_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION observability.advance_runtime_report_clock()',source); END IF;
 END LOOP;
END $$;
