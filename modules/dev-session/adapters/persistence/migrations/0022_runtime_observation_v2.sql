-- RFC-034 v2（proposal/rfc/RFC-034-runtime-observability/redesign-v2-20261014.md §7）：断代。
-- 开发执行改为派发前受理一条 observability.agent_calls 记录，用量由 Session 转交 Runner 快照；退役开发用量 owner
-- 表、逻辑结束与原生活动历史。生产从未开启开发采集，这些表与列内没有需要保留的数据（作者 2026-10-14 确认不迁移）。
DROP TABLE IF EXISTS dev_session.observation_activity_history CASCADE;
DROP TABLE IF EXISTS dev_session.development_agent_endings, dev_session.development_agent_usage CASCADE;
DROP FUNCTION IF EXISTS dev_session.guard_cli_capability_original() CASCADE;
ALTER TABLE dev_session.agent_starts DROP COLUMN IF EXISTS logical_ending;

-- 项目删除的内容守卫不再认识已退役的开发用量表；其余语义与 0016 / 0017 相同。
CREATE OR REPLACE FUNCTION dev_session.content_links(table_name text,body jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE result jsonb:=jsonb_build_object('workspace',body->'task_id','project',body->'project_id');BEGIN
 CASE table_name
 WHEN 'native_terminal_starts' THEN result:=result||jsonb_build_object('runtime',body->'execution_task_id','previous',body->'execution'->'previousTaskId','agent',body->'agent_id');
 WHEN 'agent_starts' THEN result:=result||jsonb_build_object('runtime',body->'execution_task_id','previous',body->'execution'->'previousTaskId','agent',body->'agent_id');
 WHEN 'native_activity_states','native_activity_items','native_activity_reads' THEN result:=result||jsonb_build_object('agent',body->'agent_id');
 WHEN 'native_activity_sources' THEN result:=result||jsonb_build_object('runtime',body->'source_task_id');
 WHEN 'cluster_agent_restarts' THEN result:=jsonb_build_object('operation',body->'operation_id','runtime',body->'task_id','agent',body->'agent_id');
 ELSE NULL;
 END CASE;RETURN result;
END $$;
CREATE OR REPLACE FUNCTION dev_session.guard_all_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE body jsonb;links jsonb;previous jsonb;projects text[]:=ARRAY[]::text[];original text;field text;backend integer;BEGIN
 body:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;links:=dev_session.content_links(TG_TABLE_NAME,body);
 IF TG_OP='UPDATE' THEN previous:=dev_session.content_links(TG_TABLE_NAME,to_jsonb(OLD));
 IF previous IS DISTINCT FROM links THEN RAISE EXCEPTION 'Development original parent and project links cannot be replaced';END IF;END IF;
 IF NULLIF(links->>'project','') IS NOT NULL THEN projects:=array_append(projects,links->>'project');END IF;
 IF NOT EXISTS(SELECT 1 FROM dev_session.content_origins WHERE(kind='task' AND key IN(links->>'workspace',links->>'runtime',links->>'previous'))
 OR(kind='cluster-operation' AND key=links->>'operation')) AND cardinality(projects)=0 THEN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('dev-session.content-origins',0));END IF;
 FOREACH field IN ARRAY ARRAY['workspace','runtime','previous','operation'] LOOP
 IF NULLIF(links->>field,'') IS NULL THEN CONTINUE;END IF;
 SELECT project_id INTO original FROM dev_session.content_origins WHERE kind=CASE WHEN field='operation' THEN 'cluster-operation' ELSE 'task' END AND key=links->>field;
 IF original IS NOT NULL THEN projects:=array_append(projects,original);END IF;END LOOP;
 IF (SELECT count(DISTINCT item) FROM unnest(projects) item)>1 THEN RAISE EXCEPTION 'Development original content project links conflict';END IF;
 BEGIN backend:=NULLIF(current_setting('crewstation.shared_admission_pid',true),'')::integer;EXCEPTION WHEN OTHERS THEN backend:=NULL;END;
 FOREACH original IN ARRAY projects LOOP
 IF NOT COALESCE(dev_session.work_admitted(original,backend),false) AND NOT dev_session.work_locked(original,'ExclusiveLock',pg_backend_pid()) THEN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('dev-session.project-admission:'||original,0));END IF;
 IF EXISTS(SELECT 1 FROM dev_session.project_admissions WHERE project_id=original) AND NOT(TG_OP='DELETE' AND dev_session.metadata_permitted(original))
 AND NOT(COALESCE(dev_session.stop_write_permitted(original,backend),false) AND TG_OP='UPDATE') THEN
 RAISE EXCEPTION 'Development project content admission is permanently sealed';END IF;END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
