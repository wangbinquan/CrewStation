-- Source gaps are shared across period views. They never become a numerical population ceiling.
CREATE TABLE observability.runtime_source_quality(task_id text PRIMARY KEY,project_id text NOT NULL,source_kind text NOT NULL,started_at timestamptz NOT NULL,ended_at timestamptz,gaps jsonb NOT NULL);
CREATE INDEX runtime_source_quality_project ON observability.runtime_source_quality(project_id,source_kind,started_at,ended_at);
CREATE INDEX runtime_source_quality_system ON observability.runtime_source_quality(started_at,ended_at);
CREATE TRIGGER observation_content_guard BEFORE INSERT OR UPDATE OR DELETE ON observability.runtime_source_quality FOR EACH ROW EXECUTE FUNCTION observability.guard_content();
