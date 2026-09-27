import { sql } from 'drizzle-orm';

/** Only public task fields are selected; command payloads, model configuration and outputs never enter this view. */
export function taskListRows(projectId?: string) {
  return sql`WITH parents AS (
    SELECT id,project_id,service_id,caller_identity,'legacy'::text AS protocol,state,labels,message,created_at,
      greatest(updated_at,(SELECT max(coalesce(c.ended_at,c.started_at,c.created_at)) FROM business_task.subtasks c WHERE c.task_id=tasks.id)) AS updated_at
    FROM business_task.tasks WHERE ${projectId ? sql`project_id=${projectId}` : sql`true`}
    UNION ALL
    SELECT p.intent->'task'->>'id',p.intent->>'projectId',p.service_id,p.intent->>'callerIdentity','v3',
      CASE WHEN p.state='failed' THEN 'failed' WHEN s.operation_id IS NOT NULL THEN s.state
        ELSE coalesce(l.task_state,s.state,CASE WHEN p.state='succeeded' THEN 'unknown' ELSE p.intent->'task'->>'state' END) END,
      p.intent->'task'->'labels',p.error_code,p.created_at,
      greatest(p.updated_at,coalesce((SELECT max(e.created_at) FROM business_task.execution_events e WHERE e.task_id=p.intent->'task'->>'id'),p.updated_at))
    FROM business_task.execution_operations p
      LEFT JOIN business_task.execution_task_states s ON s.task_id=p.intent->'task'->>'id'
      LEFT JOIN business_task.execution_logs l ON l.task_id=p.intent->'task'->>'id'
    WHERE p.kind='create-task' AND ${projectId ? sql`p.intent->>'projectId'=${projectId}` : sql`true`}
  ), children AS (
    SELECT t.task_id,'legacy'::text AS protocol,t.id,t.name,t.state,false AS unknown,t.error AS message,coalesce(t.ended_at,t.started_at,t.created_at) AS updated_at
    FROM business_task.subtasks t WHERE t.state='failed' AND NOT EXISTS (SELECT 1 FROM business_task.subtasks n WHERE n.retry_of=t.id)
    UNION ALL
    SELECT t.task_id,'v3',t.id,t.view->>'name',t.view->>'state',t.view->>'process'='unknown' OR t.dispatch='unknown',t.view->'error'->>'message',t.updated_at
    FROM business_task.execution_subtasks t WHERE (t.view->>'state'='failed' OR t.view->>'process'='unknown' OR t.dispatch='unknown')
      AND NOT EXISTS (SELECT 1 FROM business_task.execution_subtasks n WHERE n.task_id=t.task_id AND n.view->>'previousId'=t.id)
  ), ranked AS (
    SELECT p.*,coalesce(c.failed_count,0) AS failed_count,coalesce(c.unknown_count,0) AS unknown_count,c.latest_failure,
      CASE WHEN p.state='failed' OR coalesce(c.failed_count,0)>0 THEN 0
        WHEN p.state='unknown' OR coalesce(c.unknown_count,0)>0 THEN 1 ELSE 2 END AS rank
    FROM parents p LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE state='failed') AS failed_count,count(*) FILTER (WHERE unknown) AS unknown_count,
        (array_agg(jsonb_strip_nulls(jsonb_build_object('id',id,'name',name,'state',CASE WHEN unknown THEN 'unknown' ELSE state END,'message',message)) ORDER BY updated_at DESC,id))[1] AS latest_failure
      FROM children c WHERE c.task_id=p.id AND c.protocol=p.protocol
    ) c ON true
  )`;
}
