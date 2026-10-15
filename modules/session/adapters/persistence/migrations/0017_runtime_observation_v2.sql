-- RFC-034 v2（proposal/rfc/RFC-034-runtime-observability/redesign-v2-20261014.md §4/§7）：断代。
-- Session 不再保存观测数值：退役业务数值外发箱、开发用量副本与运行片段历史。用量改为 Runner 事件里的
-- 执行快照，由 Session 收到后经 AgentCallSink 交给 observability；v1 数据不迁移（作者 2026-10-14 确认）。
DROP TRIGGER IF EXISTS retain_observation_fragment ON session.runner_events;
DROP TABLE IF EXISTS session.observation_fragment_history, session.business_usage_events, session.business_usage_sources,
  session.development_usage_events, session.development_usage_streams CASCADE;
DROP FUNCTION IF EXISTS session.retain_observation_fragment() CASCADE;
DROP FUNCTION IF EXISTS session.original_observation_fragment(jsonb) CASCADE;

-- 项目删除停止快照的表集合随之收窄（与 domain/deletion/stopSnapshot.ts 的 SESSION_DELETION_TABLES 一致）。
CREATE OR REPLACE FUNCTION session.stop_snapshot(project text,keys jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE name text;predicate text;body_expression text;row_count bigint;row_digest text;tables jsonb:='[]'::jsonb;total bigint:=0;BEGIN
 IF jsonb_typeof(keys) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Session snapshot requires complete original task keys';END IF;
 FOREACH name IN ARRAY ARRAY['runner_events','connections','business_execution_events',
 'business_stopped_executions','execution_completion_proofs','business_executions','connection_births','original_callbacks'] LOOP
  predicate:=CASE WHEN name='original_callbacks' THEN 'content.project_id=$1'
   WHEN name='connection_births' THEN 'content.task_key IN(SELECT jsonb_array_elements_text($2))'
   ELSE 'content.task_id IN(SELECT jsonb_array_elements_text($2))' END;
  body_expression:=CASE WHEN name='connections' THEN 'to_jsonb(content)-''last_seen_at''' ELSE 'to_jsonb(content)' END;
  EXECUTE format('SELECT count(*),session.digest(COALESCE(jsonb_agg(session.digest(%s) ORDER BY session.digest(%s)),''[]''::jsonb)) FROM session.%I content WHERE %s',
   body_expression,body_expression,name,predicate) INTO row_count,row_digest USING project,keys;
  tables:=tables||jsonb_build_array(jsonb_build_object('table',name,'count',row_count,'digest',row_digest));total:=total+row_count;
 END LOOP;
 RETURN jsonb_build_object('tables',tables,'count',total,'digest',session.digest(tables));
END $$;

-- 内容守卫不再列出已退役的数值表；其余语义与 0014 相同。
CREATE OR REPLACE FUNCTION session.guard_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task text;project text;scope session.project_deletions%ROWTYPE;key text;backend integer;before_body jsonb;after_body jsonb;BEGIN
 task:=CASE WHEN TG_OP='DELETE' THEN OLD.task_id ELSE NEW.task_id END;
 IF TG_OP='UPDATE' AND OLD.task_id<>NEW.task_id THEN RAISE EXCEPTION 'Session original task identity cannot be replaced';END IF;
 SELECT project_id INTO project FROM session.task_origins WHERE task_key=task;key:=session.admission_key(task);
 BEGIN backend:=NULLIF(current_setting('crewstation.shared_admission_pid',true),'')::integer;EXCEPTION WHEN OTHERS THEN backend:=NULL;END;
 IF NULLIF(current_setting('crewstation.session_work_callback',true),'') IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM session.original_callbacks c WHERE c.id=current_setting('crewstation.session_work_callback',true)
  AND c.task_key=task AND c.backend_pid=backend AND c.exited_at IS NULL
  AND c.exit_key_hash=session.digest(to_jsonb(current_setting('crewstation.session_work_key',true)))
  AND COALESCE(session.work_admitted(c.project_id,backend),false)) THEN
  RAISE EXCEPTION 'Session original callback cannot expand to another task';END IF;
 IF key IS NOT NULL AND NOT COALESCE(session.work_admitted(project,backend),false) AND NOT session.locked(key,'ExclusiveLock',pg_backend_pid()) THEN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended(key,0));END IF;
 SELECT * INTO scope FROM session.project_deletions WHERE project_id=project;
 IF NOT FOUND THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 IF TG_TABLE_NAME='connections' THEN
  IF TG_OP='UPDATE' AND to_jsonb(NEW)-'last_seen_at'=to_jsonb(OLD)-'last_seen_at' THEN RETURN NEW;END IF;
  IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM session.connection_births WHERE id=OLD.consumer_id AND exited_at IS NOT NULL) THEN RETURN OLD;END IF;
 END IF;
 IF TG_OP='DELETE' AND scope.verified AND scope.phases ? 'namespace'
  AND current_setting('crewstation.session_deletion',true)=scope.operation_id||':'||scope.generation||':metadata'
  AND session.locked(key,'ExclusiveLock',pg_backend_pid())
  AND NOT EXISTS(SELECT 1 FROM session.original_callbacks WHERE project_id=project AND exited_at IS NULL) THEN RETURN OLD;END IF;
 IF NOT COALESCE(session.stop_write_permitted(task,backend),false) OR TG_OP='DELETE'
  OR TG_TABLE_NAME NOT IN('business_executions','business_execution_events','business_stopped_executions','execution_completion_proofs') THEN
  RAISE EXCEPTION 'Session project admission is closed';END IF;
 IF TG_OP='UPDATE' THEN
  before_body:=to_jsonb(OLD);after_body:=to_jsonb(NEW);
  IF TG_TABLE_NAME IN('business_execution_events','business_stopped_executions','execution_completion_proofs') THEN
   RAISE EXCEPTION 'Session original numeric evidence is immutable';END IF;
  IF TG_TABLE_NAME='business_executions' AND(before_body->'execution_id' IS DISTINCT FROM after_body->'execution_id'
   OR before_body->'receipt'->'executionId' IS DISTINCT FROM after_body->'receipt'->'executionId'
   OR before_body->'receipt'->'attemptId' IS DISTINCT FROM after_body->'receipt'->'attemptId'
   OR before_body->'receipt'->'incarnationId' IS DISTINCT FROM after_body->'receipt'->'incarnationId'
   OR before_body->'receipt'->'payloadDigest' IS DISTINCT FROM after_body->'receipt'->'payloadDigest') THEN
   RAISE EXCEPTION 'Session original business execution cannot be replaced';END IF;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME='business_executions' THEN
  RAISE EXCEPTION 'Session cleanup cannot register a new numeric execution';END IF;
 RETURN NEW;
END $$;
