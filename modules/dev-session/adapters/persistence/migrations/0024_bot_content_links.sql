CREATE OR REPLACE FUNCTION dev_session.content_links(table_name text,body jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE result jsonb:=jsonb_build_object('workspace',body->'task_id','project',body->'project_id');BEGIN
 CASE table_name
 WHEN 'native_terminal_starts' THEN result:=result||jsonb_build_object('runtime',body->'execution_task_id','previous',body->'execution'->'previousTaskId','agent',body->'agent_id');
 WHEN 'agent_starts' THEN result:=result||jsonb_build_object('runtime',body->'execution_task_id','previous',body->'execution'->'previousTaskId','agent',body->'agent_id');
 WHEN 'native_activity_states','native_activity_items','native_activity_reads' THEN result:=result||jsonb_build_object('agent',body->'agent_id');
 WHEN 'native_activity_sources' THEN result:=result||jsonb_build_object('runtime',body->'source_task_id');
 WHEN 'cluster_agent_restarts' THEN result:=jsonb_build_object('operation',body->'operation_id','runtime',body->'task_id','agent',body->'agent_id');
 WHEN 'bot_conversations' THEN result:=result||jsonb_build_object('conversation',body->'id');
 WHEN 'bot_messages' THEN result:=result||jsonb_build_object('request',body->'request_id','conversation',body->'data'->'receipt'->'conversationId');
 WHEN 'bot_executions' THEN result:=result||jsonb_build_object('runtime',body->'execution_task_id','previous',body->'data'->'previousExecutionId','agent',body->'agent_id','conversation',body->'data'->'conversationId');
 ELSE NULL;
 END CASE;RETURN result;
END $$;

