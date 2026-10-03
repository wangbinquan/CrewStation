-- Qualify the original parent body against JSON columns in historical finalizations.
CREATE OR REPLACE FUNCTION business_task.content_links(table_name text,body jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE parent jsonb;result jsonb:=jsonb_build_object('service',body->'service_id','project',body->'project_id','task',body->'task_id');BEGIN
 CASE table_name
 WHEN 'tasks' THEN result:=result||jsonb_build_object('task',body->'id');
 WHEN 'execution_operations' THEN result:=result||jsonb_build_object('project',body->'intent'->'projectId','task',body->'intent'->'task'->'id');
 WHEN 'subtasks' THEN result:=result||jsonb_build_object('runtime',body->'spec'->'execution'->'taskId');
 WHEN 'cluster_commands' THEN result:=result||jsonb_build_object('runtime',body->'body'->'operation'->'target'->'taskId','legacy',body->'legacy_body'->'operation'->'target'->'taskId');
 WHEN 'execution_subtasks' THEN result:=result||jsonb_build_object('runtime',body->'runtime_task_id','home',body->'session_key');
 WHEN 'execution_messages' THEN result:=result||jsonb_build_object('runtime',body->'runtime_task_id');
 WHEN 'execution_sessions' THEN result:=result||jsonb_build_object('runtime',body->'session_key');
 WHEN 'execution_session_homes' THEN result:=result||jsonb_build_object('runtime',body->'session_key');
 WHEN 'legacy_mutations' THEN result:=result||jsonb_build_object('runtime',body->'task_id');
 WHEN 'finalizations' THEN result:=result||jsonb_build_object('project',body->'body'->'projectId');
 WHEN 'subtask_projections' THEN SELECT to_jsonb(p) INTO parent FROM business_task.execution_subtasks p WHERE p.id=body->>'subtask_id';
 WHEN 'recovery_audit' THEN SELECT to_jsonb(p) INTO parent FROM business_task.recovery_requests p WHERE p.id=body->>'request_id';
 WHEN 'finalization_execution_proofs' THEN SELECT to_jsonb(p)||jsonb_build_object('project_id',p.body->'projectId') INTO parent FROM business_task.finalizations p WHERE p.id=body->>'operation_id';
 WHEN 'finalization_revisions' THEN SELECT to_jsonb(p)||jsonb_build_object('project_id',p.body->'projectId') INTO parent FROM business_task.finalizations p WHERE p.id=body->>'finalization_id';
 ELSE NULL;
 END CASE;
 IF table_name IN('subtask_projections','recovery_audit','finalization_execution_proofs','finalization_revisions') THEN
 IF parent IS NULL THEN RAISE EXCEPTION 'Business child content has no original parent';END IF;
 result:=jsonb_build_object('service',parent->'service_id','project',parent->'project_id','task',parent->'task_id');END IF;
 RETURN result;
END $$;
