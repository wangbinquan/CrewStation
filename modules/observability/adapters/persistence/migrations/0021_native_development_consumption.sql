-- RFC-034: recoverable original-page references only. Token and CNY remain in the one usage ledger.
CREATE TABLE observability.development_native_passes (
  pass_key text PRIMARY KEY, task_key text NOT NULL, project_id text NOT NULL, task_id text NOT NULL, source_id text NOT NULL,
  document jsonb NOT NULL, fingerprint text NOT NULL, progress jsonb NOT NULL,
  state text NOT NULL CHECK(state IN ('receiving','source-eof')), work_state text NOT NULL CHECK(work_state IN ('pending','processed')),
  work_cursor text
);
CREATE INDEX development_native_pending ON observability.development_native_passes(work_state,pass_key);
CREATE TABLE observability.development_native_pages (
  pass_key text NOT NULL, ordinal text NOT NULL CHECK(ordinal~'^(0|[1-9][0-9]*)$'), task_key text NOT NULL, project_id text NOT NULL, task_id text NOT NULL,
  document jsonb NOT NULL, fingerprint text NOT NULL, packet_count integer NOT NULL CHECK(packet_count BETWEEN 1 AND 10), complete boolean NOT NULL,
  PRIMARY KEY(pass_key,ordinal)
);
CREATE TABLE observability.development_native_packets (
  pass_key text NOT NULL, ordinal text NOT NULL, packet_index integer NOT NULL CHECK(packet_index BETWEEN 0 AND 9),
  task_key text NOT NULL, project_id text NOT NULL, task_id text NOT NULL, source_id text NOT NULL,
  sequence text NOT NULL CHECK(sequence~'^(0|[1-9][0-9]*)$'), fingerprint text NOT NULL,
  PRIMARY KEY(pass_key,ordinal,packet_index), UNIQUE(source_id,sequence)
);
CREATE TABLE observability.development_native_sessions (
  pass_key text NOT NULL, original_id text NOT NULL, task_key text NOT NULL, project_id text NOT NULL, task_id text NOT NULL,
  document jsonb NOT NULL, fingerprint text NOT NULL, PRIMARY KEY(pass_key,original_id)
);
CREATE TABLE observability.development_native_steps (
  pass_key text NOT NULL, original_id text NOT NULL, task_key text NOT NULL, project_id text NOT NULL, task_id text NOT NULL,
  document jsonb NOT NULL, fingerprint text NOT NULL, PRIMARY KEY(pass_key,original_id)
);
CREATE TABLE observability.development_native_paths (
  pass_key text NOT NULL, session_id text NOT NULL, parent_session_id text, depth text NOT NULL CHECK(depth~'^(0|[1-9][0-9]*)$'),
  path_digest text NOT NULL CHECK(path_digest~'^[a-f0-9]{64}$'), source_namespace text NOT NULL CHECK(source_namespace~'^[a-f0-9]{64}$'),
  task_key text NOT NULL, project_id text NOT NULL, task_id text NOT NULL, PRIMARY KEY(pass_key,session_id)
);
CREATE INDEX development_native_children ON observability.development_native_sessions(pass_key,(document->>'parentSessionId'),original_id);
-- Original admission, cleanup and report revision hooks are attached below unchanged.

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
    'native_captures','native_capture_history','native_steps','native_baselines','native_repairs','development_model_evidence','execution_valuations','execution_valuation_receipts','development_native_passes','development_native_pages','development_native_packets','development_native_sessions','development_native_steps','development_native_paths')
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

DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['development_native_passes','development_native_pages','development_native_packets','development_native_sessions','development_native_steps','development_native_paths'] LOOP
  EXECUTE format('CREATE TRIGGER observation_content_guard BEFORE UPDATE OR DELETE ON observability.%I FOR EACH ROW EXECUTE FUNCTION observability.guard_content()',name);
  EXECUTE format('CREATE TRIGGER observation_insert_guard AFTER INSERT ON observability.%I REFERENCING NEW TABLE AS observation_new FOR EACH STATEMENT EXECUTE FUNCTION observability.guard_inserted_content()',name);
  EXECUTE format('CREATE TRIGGER observation_original_drain_guard BEFORE INSERT OR UPDATE OR DELETE ON observability.%I FOR EACH ROW EXECUTE FUNCTION observability.guard_original_drain_content()',name);
  EXECUTE format('CREATE TRIGGER runtime_report_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON observability.%I FOR EACH STATEMENT EXECUTE FUNCTION observability.advance_runtime_report_clock()',name);
 END LOOP;
END $$;
