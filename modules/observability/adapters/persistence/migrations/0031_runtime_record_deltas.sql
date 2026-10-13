-- Qualified row versions are shared by every period view. A new self measurement adds only its affected component rows.
CREATE SEQUENCE observability.runtime_row_publication_sequence;
ALTER TABLE observability.runtime_task_work ADD COLUMN requires_full boolean NOT NULL DEFAULT true;
CREATE TABLE observability.runtime_task_record_work(task_id text NOT NULL,meter_key text NOT NULL,PRIMARY KEY(task_id,meter_key));
CREATE TABLE observability.runtime_task_current_rows(task_id text NOT NULL,role text NOT NULL,key text NOT NULL,document jsonb NOT NULL,PRIMARY KEY(task_id,role,key));
CREATE TABLE observability.runtime_task_row_history(task_id text NOT NULL,role text NOT NULL,key text NOT NULL,sequence numeric NOT NULL,document jsonb,PRIMARY KEY(task_id,role,key,sequence));
CREATE INDEX runtime_row_history_seek ON observability.runtime_task_row_history(task_id,role,key,sequence DESC);
CREATE INDEX runtime_current_record ON observability.runtime_task_current_rows(task_id,role,(document#>>'{record,original,sourceId}'),(document#>>'{record,original,recordId}'));
CREATE INDEX runtime_current_model_execution ON observability.runtime_task_current_rows(task_id,role,(document#>>'{record,original,modelRef}'),(document#>>'{record,original,identity,executionId}'));
CREATE INDEX runtime_current_public_record ON observability.runtime_task_current_rows(task_id,role,(document#>>'{document,sourceId}'),(document#>>'{document,recordId}'));
CREATE INDEX runtime_current_public_sections ON observability.runtime_task_current_rows(task_id,role,(document->>'section'),(document->>'parent'),(document->>'key'));
CREATE FUNCTION observability.runtime_view_rows(task text,version text,through numeric,selected_role text) RETURNS TABLE(role text,key text,document jsonb) LANGUAGE sql STABLE AS $$
 SELECT r.role,r.key,r.document FROM observability.runtime_task_cache_rows r WHERE $3 IS NULL AND r.task_id=$1 AND r.version=$2 AND r.role=$4
 UNION ALL SELECT "x"."role","x"."key","x"."document" FROM (SELECT DISTINCT ON(h.key) h.role,h.key,h.document FROM observability.runtime_task_row_history h WHERE $3 IS NOT NULL AND h.task_id=$1 AND h.role=$4 AND h.sequence<=$3 ORDER BY h.key,h.sequence DESC) x WHERE "x"."document" IS NOT NULL
$$;
CREATE FUNCTION observability.dirty_runtime_self_record(target text,project text,meter text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO observability.runtime_task_work(key,project_id,requires_full) VALUES(target,project,false) ON CONFLICT(key) DO UPDATE SET revision=nextval('observability.runtime_task_change_sequence'),project_id=coalesce("excluded"."project_id",observability.runtime_task_work.project_id);
 INSERT INTO observability.runtime_task_record_work(task_id,meter_key) VALUES(target,meter) ON CONFLICT DO NOTHING;
END $$;
-- Original non-record changes force canonical coverage qualification; they cannot be erased by a later record event.
CREATE OR REPLACE FUNCTION observability.dirty_runtime_task_project(key text,project text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO observability.runtime_task_work(key,project_id,requires_full) SELECT key,project,true WHERE key IS NOT NULL AND length(key)>0 ON CONFLICT(key) DO UPDATE SET revision=nextval('observability.runtime_task_change_sequence'),project_id=coalesce("excluded"."project_id",observability.runtime_task_work.project_id),requires_full=true
$$;

CREATE FUNCTION observability.occurrence_hour(at timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(to_char(date_trunc('hour',at AT TIME ZONE 'UTC'),'YYYY-MM-DD"T"HH24:00:00.000"Z"'),'unknown') $$;
CREATE INDEX runtime_occurrence_record_hour ON observability.runtime_occurrence(task_id,observability.occurrence_hour(occurred_at),execution_key,key);
