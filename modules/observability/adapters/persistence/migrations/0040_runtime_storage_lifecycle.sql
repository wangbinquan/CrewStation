-- Derived report lifetime; accepted usage, captures, prices and audit are never expired.
CREATE TABLE observability.runtime_report_leases(id text PRIMARY KEY,kind text NOT NULL CHECK(kind IN('lazy','legacy')),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '7 days',retiring boolean NOT NULL DEFAULT false);
CREATE INDEX runtime_report_lease_expiry ON observability.runtime_report_leases(retiring,expires_at,id);
INSERT INTO observability.runtime_report_leases(id,kind) SELECT id,'lazy' FROM observability.runtime_lazy_reports;
INSERT INTO observability.runtime_report_leases(id,kind) SELECT id,'legacy' FROM observability.runtime_reports;
CREATE TABLE observability.runtime_storage_guard(singleton boolean PRIMARY KEY CHECK(singleton),generation bigint NOT NULL DEFAULT 0,history_cursor jsonb,cache_cursor jsonb,last_success timestamptz,last_error text,reclaimed numeric NOT NULL DEFAULT 0);
INSERT INTO observability.runtime_storage_guard(singleton) VALUES(true);
CREATE TABLE observability.runtime_storage_samples(day date PRIMARY KEY,sampled_at timestamptz NOT NULL,document jsonb NOT NULL);
ALTER TABLE observability.runtime_task_work ADD COLUMN queued_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE TABLE observability.runtime_report_task_documents(key text PRIMARY KEY,document jsonb NOT NULL);
ALTER TABLE observability.runtime_report_task_refs ADD COLUMN document_key text REFERENCES observability.runtime_report_task_documents(key);
CREATE INDEX runtime_report_document_refs ON observability.runtime_report_task_refs(document_key);
CREATE VIEW observability.runtime_report_task_views AS SELECT r.report_id,r.ordinal,r.task_id,r.version,r.project_id,coalesce(d.document,r.document) AS document FROM observability.runtime_report_task_refs r LEFT JOIN observability.runtime_report_task_documents d ON d.key=r.document_key;
CREATE FUNCTION observability.guard_runtime_task_document() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.document IS DISTINCT FROM NEW.document THEN RAISE EXCEPTION 'shared runtime task document identity collision'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER runtime_task_document_immutable BEFORE UPDATE ON observability.runtime_report_task_documents FOR EACH ROW EXECUTE FUNCTION observability.guard_runtime_task_document();
CREATE OR REPLACE FUNCTION observability.guard_runtime_view_original() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state<>'building' AND NEW IS DISTINCT FROM OLD AND NOT (NEW.request_key='retired/'||OLD.id AND (to_jsonb(NEW)-'request_key')=(to_jsonb(OLD)-'request_key')) THEN RAISE EXCEPTION 'published runtime view is immutable'; END IF; RETURN NEW;
END $$;
CREATE INDEX runtime_history_sweep ON observability.runtime_task_row_history(task_id,role,key,sequence);
