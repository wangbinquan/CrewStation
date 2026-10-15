-- RFC-034 v2（proposal/rfc/RFC-034-runtime-observability/redesign-v2-20261014.md §7）：断代。
-- 开发 Agent 不再有独立数值存储，因此退役为它服务的父结束、恢复接续与删除保护材料；运行生命周期观测改由
-- observability.agent_calls 记录。生产从未开启开发采集，这些表与列内没有需要保留的数据（作者 2026-10-14 确认不迁移）。
DROP TRIGGER IF EXISTS retain_observation_lifecycle ON task_runtime.environments;
DROP TABLE IF EXISTS task_runtime.observation_lifecycle CASCADE;
DROP FUNCTION IF EXISTS task_runtime.retain_observation_lifecycle() CASCADE;
DROP FUNCTION IF EXISTS task_runtime.guard_observation_lifecycle_birth() CASCADE;

DROP TABLE IF EXISTS task_runtime.development_parent_rebuild_claims, task_runtime.development_parent_ending_objects,
  task_runtime.development_parent_ending_children, task_runtime.development_parent_endings, task_runtime.development_parent_recovery_sweep CASCADE;
DROP FUNCTION IF EXISTS task_runtime.guard_parent_ending_identity() CASCADE;
DROP FUNCTION IF EXISTS task_runtime.guard_parent_child_identity() CASCADE;
DROP FUNCTION IF EXISTS task_runtime.guard_parent_object_identity() CASCADE;
DROP FUNCTION IF EXISTS task_runtime.guard_parent_membership() CASCADE;
DROP FUNCTION IF EXISTS task_runtime.guard_parent_object_admission() CASCADE;

ALTER TABLE task_runtime.environments DROP COLUMN IF EXISTS parent_ending_present, DROP COLUMN IF EXISTS parent_ending_kind;
ALTER TABLE task_runtime.environments DROP COLUMN IF EXISTS parent_ending;
ALTER TABLE task_runtime.environment_rebuilds DROP COLUMN IF EXISTS development_parent_binding_present, DROP COLUMN IF EXISTS development_parent_binding_kind;
ALTER TABLE task_runtime.environment_rebuilds DROP COLUMN IF EXISTS development_parent_binding;

-- 项目删除的内容守卫不再认识已退役的父结束材料；其余语义与 0023 相同。
CREATE OR REPLACE FUNCTION task_runtime.content_links(table_name text,body jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE result jsonb:=jsonb_build_object('project',body->'project_id','service',body->'service_id','task',body->'task_id');BEGIN
 CASE table_name
 WHEN 'environments' THEN result:=result||jsonb_build_object('task',body->'id','parent',body->'native'->'parentTaskId','rebuild',body->'rebuild_id');
 IF body->>'kind'='profile-test' THEN result:=result||jsonb_build_object('project',body->'render'->'runtimeValidation'->'projectId','service',NULL);END IF;
 WHEN 'environment_rebuilds' THEN result:=result||jsonb_build_object('rebuild',body->'id');
 WHEN 'archive_executions' THEN result:=result||jsonb_build_object('project',body->'body'->'projectId','service',body->'body'->'serviceId','bodyTask',body->'body'->'taskId');
 WHEN 'unprovisioned_storage' THEN result:=result||jsonb_build_object('project',body->'body'->'input'->'projectId','service',body->'body'->'input'->'serviceId','bodyTask',body->'body'->'input'->'taskId');
 ELSE NULL;
 END CASE;RETURN result;
END $$;
CREATE OR REPLACE FUNCTION task_runtime.content_projects(links jsonb) RETURNS text[] LANGUAGE sql STABLE AS $$
 SELECT COALESCE(array_agg(DISTINCT project),'{}'::text[]) FROM (
 SELECT COALESCE((SELECT project_id FROM task_runtime.work_origins WHERE kind='project' AND key=links->>'project'),NULLIF(links->>'project','')) AS project
 UNION SELECT project_id FROM task_runtime.work_origins WHERE(kind='service' AND key=links->>'service')
 OR(kind='task' AND key IN(links->>'task',links->>'parent',links->>'bodyTask')) OR(kind='rebuild' AND key=links->>'rebuild')
 UNION SELECT CASE WHEN kind='profile-test' THEN render->'runtimeValidation'->>'projectId' ELSE project_id END FROM task_runtime.environments
 WHERE id IN(links->>'task',links->>'parent',links->>'bodyTask') OR service_id=links->>'service'
 UNION SELECT project_id FROM task_runtime.environment_rebuilds WHERE id=links->>'rebuild'
 ) original WHERE project IS NOT NULL
$$;
CREATE OR REPLACE FUNCTION task_runtime.guard_all_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE body jsonb;links jsonb;previous jsonb;projects text[];original text;backend integer;BEGIN
 body:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;links:=task_runtime.content_links(TG_TABLE_NAME,body);
 IF TG_OP='UPDATE' THEN previous:=task_runtime.content_links(TG_TABLE_NAME,to_jsonb(OLD));
 IF previous->'project' IS DISTINCT FROM links->'project' OR previous->'service' IS DISTINCT FROM links->'service'
 OR previous->'task' IS DISTINCT FROM links->'task' OR previous->'parent' IS DISTINCT FROM links->'parent' OR previous->'bodyTask' IS DISTINCT FROM links->'bodyTask'
 THEN RAISE EXCEPTION 'Runtime original project service task and parent links cannot be replaced';END IF;END IF;
 projects:=task_runtime.content_projects(links);
 IF cardinality(projects)=0 THEN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('task-runtime.content-origins',0));projects:=task_runtime.content_projects(links);END IF;
 IF cardinality(projects)>1 THEN RAISE EXCEPTION 'Runtime original content project links conflict';END IF;
 BEGIN backend:=NULLIF(current_setting('crewstation.shared_admission_pid',true),'')::integer;EXCEPTION WHEN OTHERS THEN backend:=NULL;END;
 FOREACH original IN ARRAY projects LOOP
 IF NOT COALESCE(task_runtime.work_admitted(original,backend),false) AND NOT task_runtime.work_locked(original,'ExclusiveLock',pg_backend_pid()) THEN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('task-runtime.project-admission:'||original,0));END IF;
 IF EXISTS(SELECT 1 FROM task_runtime.project_admissions WHERE project_id=original) AND NOT(TG_OP='DELETE' AND task_runtime.metadata_permitted(original))
 AND NOT(COALESCE(task_runtime.stop_write_permitted(original,backend),false) AND(TG_OP='UPDATE' OR TG_OP='INSERT' AND TG_TABLE_NAME='blocked_admissions')) THEN
 RAISE EXCEPTION 'Runtime project content admission is permanently sealed';END IF;END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
