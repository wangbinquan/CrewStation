-- Ordinary admission stays closed. Only the current owner's actual database transaction
-- can finish numerical copies for one task retained by the original seal.
CREATE TABLE observability.deletion_drain_admissions (
  backend integer NOT NULL, transaction_id bigint NOT NULL, nonce text NOT NULL CHECK(length(nonce)>=32),
  project_id text NOT NULL, operation_id text NOT NULL, generation integer NOT NULL,
  task_id text NOT NULL, task_key text NOT NULL, PRIMARY KEY(backend,transaction_id)
);
ALTER TABLE observability.deletion_fences ADD COLUMN stopped_revision text CHECK(stopped_revision~'^[a-f0-9]{64}$');
ALTER TABLE observability.deletion_fences ADD COLUMN stopped_count integer CHECK(stopped_count>=0);

CREATE FUNCTION observability.original_drain_admission(project text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM observability.deletion_drain_admissions a JOIN observability.deletion_fences f USING(project_id)
    WHERE a.backend=pg_backend_pid() AND a.transaction_id=txid_current()
      AND a.nonce=current_setting('crewstation.observability_drain',true) AND a.project_id=project
      AND f.verified AND f.phase_index=0 AND f.operation_id=a.operation_id AND f.generation=a.generation
      AND observability.deletion_permission(project,a.operation_id,a.generation,'stop'))
$$;
CREATE FUNCTION observability.guard_drain_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a observability.deletion_drain_admissions; f observability.deletion_fences;
BEGIN
  a:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  SELECT * INTO f FROM observability.deletion_fences WHERE project_id=a.project_id;
  IF TG_OP='UPDATE' OR a.backend<>pg_backend_pid() OR a.transaction_id<>txid_current()
    OR a.nonce IS DISTINCT FROM current_setting('crewstation.observability_drain',true)
    OR NOT coalesce(f.verified AND f.phase_index=0 AND f.operation_id=a.operation_id AND f.generation=a.generation
      AND observability.deletion_permission(a.project_id,a.operation_id,a.generation,'stop'),false)
    OR NOT EXISTS(SELECT 1 FROM observability.deletion_entities WHERE project_id=a.project_id AND kind='task' AND entity_id=a.task_id)
    OR NOT EXISTS(SELECT 1 FROM observability.deletion_entities WHERE project_id=a.project_id AND kind='task-key' AND entity_id=a.task_key) THEN
    RAISE EXCEPTION 'Original usage drain requires current private transaction and sealed task' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER observation_drain_admission_guard BEFORE INSERT OR UPDATE OR DELETE ON observability.deletion_drain_admissions
  FOR EACH ROW EXECUTE FUNCTION observability.guard_drain_admission();

CREATE OR REPLACE FUNCTION observability.admit_project(project text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE canonical text; fence observability.deletion_fences;
BEGIN
  canonical:=observability.canonical_project(project);
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('observability.project:' || canonical,0)) THEN
    RAISE EXCEPTION 'Observation project admission is closing' USING ERRCODE='55000';
  END IF;
  SELECT * INTO fence FROM observability.deletion_fences WHERE project_id=canonical;
  IF fence.project_id IS NOT NULL AND NOT coalesce(observability.original_drain_admission(canonical),false) THEN
    RAISE EXCEPTION 'Observation project is permanently closed' USING ERRCODE='55000';
  END IF;
END $$;
CREATE FUNCTION observability.guard_original_drain_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a observability.deletion_drain_admissions; content jsonb; entry text; identities text[];
BEGIN
  SELECT * INTO a FROM observability.deletion_drain_admissions WHERE backend=pg_backend_pid() AND transaction_id=txid_current()
    AND nonce=current_setting('crewstation.observability_drain',true);
  IF a.project_id IS NULL THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  IF TG_TABLE_NAME NOT IN ('usage_heads','usage_sources','usage_pages','usage_events','usage_evidence','usage_projections','usage_changes',
    'native_captures','native_capture_history','native_steps','native_baselines','native_repairs','development_model_evidence','execution_valuations','execution_valuation_receipts')
    OR TG_OP='DELETE' OR NOT coalesce(observability.original_drain_admission(a.project_id),false) THEN
    RAISE EXCEPTION 'Original usage drain cannot create other project content' USING ERRCODE='55000';
  END IF;
  content:=to_jsonb(NEW);
  identities:=ARRAY[content->>'task_id',content->'document'->'identity'->>'taskId',content->'document'->'meter'->'identity'->>'taskId',
    content->'summary'->'identity'->>'taskId',content->'model_evidence'->'identity'->>'taskId'];
  FOREACH entry IN ARRAY identities LOOP
    IF entry IS NOT NULL AND entry<>a.task_id THEN RAISE EXCEPTION 'Original usage drain task identity changed' USING ERRCODE='55000'; END IF;
  END LOOP;
  IF content->>'task_key' IS NOT NULL AND content->>'task_key'<>a.task_key
    OR content->>'task_key' IS NULL AND NOT coalesce(a.task_id=ANY(identities),false)
    OR EXISTS(SELECT 1 FROM unnest(observability.row_projects(content)) p WHERE p<>a.project_id) THEN
    RAISE EXCEPTION 'Original usage drain is restricted to its sealed task and project' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' AND to_jsonb(OLD)->>'task_key' IS DISTINCT FROM content->>'task_key' THEN
    RAISE EXCEPTION 'Original usage drain cannot replace a task binding' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['accepted_execution_prices','alerts','cost_visibility','cost_visibility_receipts','development_model_evidence',
    'execution_valuation_receipts','execution_valuations','native_baselines','native_capture_history','native_captures','native_repairs','native_steps',
    'usage_changes','usage_events','usage_evidence','usage_heads','usage_pages','usage_projections','usage_snapshots','usage_sources'] LOOP
    EXECUTE format('CREATE TRIGGER observation_original_drain_guard BEFORE INSERT OR UPDATE OR DELETE ON observability.%I FOR EACH ROW EXECUTE FUNCTION observability.guard_original_drain_content()',name);
  END LOOP;
END $$;
CREATE FUNCTION observability.guard_stopped_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.generation>OLD.generation THEN
    IF NEW.stopped_revision IS NOT NULL OR NEW.stopped_count IS NOT NULL THEN RAISE EXCEPTION 'Original stop snapshot must start empty' USING ERRCODE='55000'; END IF;
  ELSIF NEW.stopped_revision IS DISTINCT FROM OLD.stopped_revision OR NEW.stopped_count IS DISTINCT FROM OLD.stopped_count THEN
    IF OLD.phase_index<>0 OR NEW.phase_index<>1 OR OLD.stopped_revision IS NOT NULL OR OLD.stopped_count IS NOT NULL
      OR NEW.stopped_revision IS NULL OR NEW.stopped_count IS NULL
      OR NOT coalesce(observability.deletion_permission(NEW.project_id,NEW.operation_id,NEW.generation,'stop'),false) THEN
      RAISE EXCEPTION 'Original stopped usage snapshot is immutable' USING ERRCODE='55000';
    END IF;
  END IF;
  IF NEW.phase_index>=1 AND (NEW.stopped_revision IS NULL OR NEW.stopped_count IS NULL) THEN
    RAISE EXCEPTION 'Original stop requires complete final usage snapshot' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER observation_stopped_snapshot_guard BEFORE INSERT OR UPDATE ON observability.deletion_fences
  FOR EACH ROW EXECUTE FUNCTION observability.guard_stopped_snapshot();
