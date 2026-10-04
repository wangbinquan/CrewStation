-- Preserve original task identities on both sides of private UPDATEs.
-- Ordinary bulk insertion returns before looking up the private transaction grant.
CREATE OR REPLACE FUNCTION observability.guard_original_drain_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a observability.deletion_drain_admissions; content jsonb; contents jsonb[]; entry text; identities text[];
BEGIN
  IF coalesce(current_setting('crewstation.observability_drain',true),'')='' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
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
  contents:=CASE WHEN TG_OP='UPDATE' THEN ARRAY[to_jsonb(OLD),to_jsonb(NEW)] ELSE ARRAY[to_jsonb(NEW)] END;
  FOREACH content IN ARRAY contents LOOP
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
  END LOOP;
  IF TG_OP='UPDATE' AND to_jsonb(OLD)->>'task_key' IS DISTINCT FROM content->>'task_key' THEN
    RAISE EXCEPTION 'Original usage drain cannot replace a task binding' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
