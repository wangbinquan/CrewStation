-- Original source completion is a quality component, not a request to rescan every numerical record.
CREATE TABLE observability.runtime_task_proof_work(task_id text NOT NULL,kind text NOT NULL,key text NOT NULL,PRIMARY KEY(task_id,kind,key));
CREATE INDEX runtime_capture_quality_attempt ON observability.runtime_task_current_rows(task_id,role,(document->>'attemptKey'));
CREATE FUNCTION observability.dirty_runtime_proof(target text,project text,kind text,original_key text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO observability.runtime_task_work(key,project_id,requires_full) VALUES(target,project,false) ON CONFLICT(key) DO UPDATE SET revision=nextval('observability.runtime_task_change_sequence'),project_id=coalesce("excluded"."project_id",observability.runtime_task_work.project_id);
 INSERT INTO observability.runtime_task_proof_work VALUES(target,kind,original_key) ON CONFLICT DO NOTHING;
END $$;
CREATE OR REPLACE FUNCTION observability.original_runtime_task_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d jsonb;i jsonb;target text;usage_meter text; project text;
BEGIN
 IF TG_TABLE_NAME IN('native_steps','native_baselines') THEN RETURN NULL;END IF;
 FOREACH d IN ARRAY CASE WHEN TG_OP='INSERT' THEN ARRAY[to_jsonb(NEW)] WHEN TG_OP='DELETE' THEN ARRAY[to_jsonb(OLD)] ELSE ARRAY[to_jsonb(OLD),to_jsonb(NEW)] END LOOP
  i:=coalesce(d->'document'->'identity',d->'document'->'meter'->'identity',d->'summary'->'identity',d->'document'->'registration'->'identity');project:=coalesce(i->>'projectId',d->>'project_id',d->'prepared'->'intent'->'identity'->>'projectId');
  target:=CASE WHEN TG_TABLE_SCHEMA='project' THEN 'project:'||(d->>'id') WHEN TG_TABLE_SCHEMA='agent_runtime' THEN 'global:profiles' WHEN TG_TABLE_NAME='cost_visibility' THEN 'project:'||(d->>'project_id')
   WHEN TG_TABLE_NAME IN('development_agent_usage','agent_starts','native_terminal_starts') THEN d->>'execution_task_id'
   WHEN TG_TABLE_NAME='observation_activity_history' THEN d->>'source_task_id'
   WHEN TG_TABLE_NAME IN('observation_lifecycle','environments') THEN coalesce(d->>'task_id',d->>'id')
   WHEN TG_TABLE_NAME='execution_operations' THEN coalesce(d->'intent'->'task'->>'id',d->'intent'->>'taskId') WHEN TG_TABLE_NAME='tasks' THEN d->>'id'
   WHEN i->>'sourceKind' IN('development-agent','development-cli') THEN i->>'executionId' ELSE coalesce(i->>'taskId',d->>'task_id') END;
  IF target IS NOT NULL THEN
   IF TG_TABLE_NAME IN('native_captures','development_native_passes') AND TG_OP<>'DELETE' THEN PERFORM observability.dirty_runtime_proof(target,project,TG_TABLE_NAME,coalesce(d->>'pass_key',d->>'id'));
   ELSIF TG_TABLE_NAME='execution_valuations' AND TG_OP<>'DELETE' THEN
     FOR usage_meter IN SELECT p.meter_key FROM observability.usage_projections p WHERE p.task_key=d->>'task_key'
       AND p.document->'identity'=d->'document'->'identity' AND p.document->>'sourceId'=d->'document'->>'sourceId'
       AND p.document->>'recordId'=d->'document'->>'recordId' LOOP
       PERFORM observability.dirty_runtime_self_record(target,project,usage_meter);
     END LOOP;
   ELSIF TG_TABLE_NAME IN('usage_projections','usage_model_evidence','development_model_evidence') AND TG_OP<>'DELETE' THEN PERFORM observability.dirty_runtime_self_record(target,project,d->>'meter_key');
   ELSE PERFORM observability.dirty_runtime_task_project(target,project);END IF;
  END IF;
 END LOOP;RETURN NULL;
END $$;
