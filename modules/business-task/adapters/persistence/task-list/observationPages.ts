import { sql } from 'drizzle-orm';
import { RuntimeTaskHeaderFactSchema, RuntimeAttemptFactSchema, type RuntimeTaskHeaderFact, type RuntimeAttemptFact, type RuntimeOwnerPage, type RuntimeOwnerPageQuery, type RuntimeFactQuery } from '@crewstation/contracts';
import { jsonHash, validation } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';

function continuation(query: RuntimeOwnerPageQuery, source: string) {
  if (!Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 500) throw validation('运行事实每页大小无效');
  const { pageSize: _size, after, ...filters } = query, scope = jsonHash(filters);
  if (after === undefined) return { scope, position: null };
  let value: unknown;
  try { value = JSON.parse(after); } catch { throw validation('运行事实游标无效'); }
  if (!Array.isArray(value) || value.length !== 6 || value[0] !== 1 || value[1] !== source || value[2] !== scope
    || typeof value[3] !== 'string' || !Number.isFinite(Date.parse(value[3])) || typeof value[4] !== 'string' || !value[4] || typeof value[5] !== 'string') throw validation('运行事实游标来源或筛选范围已改变');
  return { scope, position: { at: value[3], id: value[4], protocol: value[5] } };
}
const taskFilter = (query: RuntimeFactQuery, id: ReturnType<typeof sql>, at: ReturnType<typeof sql>) => query.taskId
  ? sql`${id}=${query.taskId}` : sql`${at}>=${query.from}::timestamptz AND ${at}<${query.to}::timestamptz`;

/** Creation cohorts and public owner fields only; no global child bound or attention-rank scan. */
export async function readBusinessObservationTaskPage(db: Executor, query: RuntimeOwnerPageQuery): Promise<RuntimeOwnerPage<RuntimeTaskHeaderFact>> {
  const { scope, position: c } = continuation(query, 'business-tasks');
  if (query.sourceKind === 'development-agent') return { items: [], nextCursor: null };
  const rows = await db.execute(sql`WITH parents AS (
    SELECT id, project_id, service_id, 'legacy'::text AS protocol, state, labels, created_at, closed_at, trace_id FROM business_task.tasks
    WHERE ${query.projectId ? sql`project_id=${query.projectId}` : sql`true`} AND ${taskFilter(query, sql`id`, sql`created_at`)}
    UNION ALL
    SELECT p.intent->'task'->>'id', p.intent->>'projectId', p.service_id, 'v3',
      CASE WHEN p.state='failed' THEN 'failed' WHEN s.operation_id IS NOT NULL THEN s.state
        ELSE coalesce(l.task_state,s.state,CASE WHEN p.state='succeeded' THEN 'unknown' ELSE p.intent->'task'->>'state' END) END,
      p.intent->'task'->'labels', p.created_at, l.closed_at, p.intent->'task'->>'traceId'
    FROM business_task.execution_operations p LEFT JOIN business_task.execution_task_states s ON s.task_id=p.intent->'task'->>'id'
      LEFT JOIN business_task.execution_logs l ON l.task_id=p.intent->'task'->>'id'
    WHERE p.kind='create-task' AND ${query.projectId ? sql`p.intent->>'projectId'=${query.projectId}` : sql`true`}
      AND ${taskFilter(query, sql`p.intent->'task'->>'id'`, sql`p.created_at`)}
  ) SELECT *, to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS position_at FROM parents
    WHERE ${c ? sql`created_at < ${c.at}::timestamptz OR (created_at = ${c.at}::timestamptz AND (id > ${c.id} OR (id=${c.id} AND protocol > ${c.protocol})))` : sql`true`}
    ORDER BY created_at DESC, id, protocol LIMIT ${query.pageSize + 1}`);
  const selected = rows.slice(0, query.pageSize), last = selected.at(-1);
  return { items: selected.map((row) => RuntimeTaskHeaderFactSchema.parse({ source: { kind: 'business-task' }, id: row['id'], projectId: row['project_id'], serviceId: row['service_id'], protocol: row['protocol'], state: row['state'], name: (row['labels'] as Record<string, string> | null)?.['name'] ?? String(row['id']), createdAt: new Date(row['created_at'] as string).toISOString(), closedAt: row['closed_at'] ? new Date(row['closed_at'] as string).toISOString() : null, traceId: row['trace_id'] ?? null })),
    nextCursor: rows.length > query.pageSize && last ? JSON.stringify([1, 'business-tasks', scope, last['position_at'], last['id'], last['protocol']]) : null };
}

/** One stable UNION keyset covers every original legacy and v3 attempt. */
export async function readBusinessObservationAttemptPage(db: Executor, query: RuntimeOwnerPageQuery & { readonly taskId: string }): Promise<RuntimeOwnerPage<RuntimeAttemptFact>> {
  const { scope, position: c } = continuation(query, 'business-attempts');
  if (query.sourceKind === 'development-agent') return {items:[],nextCursor:null};
  const rows = await db.execute(sql`WITH children AS (
    SELECT jsonb_build_object('id',id,'taskId',task_id,'name',name,'kind',kind,'state',state,'attempt',attempt,'executionId',null,'agentId',null,'profileId',null,'profileRevision',null,'createdAt',created_at,'startedAt',started_at,'endedAt',ended_at) AS document, created_at, id, 'legacy'::text AS protocol FROM business_task.subtasks WHERE task_id=${query.taskId} AND ${query.projectId ? sql`EXISTS(SELECT 1 FROM business_task.tasks p WHERE p.id=${query.taskId} AND p.project_id=${query.projectId})` : sql`true`}
    UNION ALL
    SELECT jsonb_build_object('id',id,'taskId',task_id,'name',view->>'name','kind',view->>'kind','state',view->>'state','attempt',view->'attempt','executionId',view->>'executionId','agentId',view->>'agentProfileId','profileId',view->>'computeProfileId','profileRevision',view->'profileRevision','createdAt',view->>'createdAt','startedAt',view->>'startedAt','endedAt',view->>'endedAt'), (view->>'createdAt')::timestamptz, id, 'v3' FROM business_task.execution_subtasks WHERE task_id=${query.taskId} AND ${query.projectId ? sql`EXISTS(SELECT 1 FROM business_task.execution_operations p WHERE p.kind='create-task' AND p.intent->'task'->>'id'=${query.taskId} AND p.intent->>'projectId'=${query.projectId})` : sql`true`}
  ) SELECT *, to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS position_at FROM children
    WHERE ${c ? sql`created_at > ${c.at}::timestamptz OR (created_at=${c.at}::timestamptz AND (id>${c.id} OR (id=${c.id} AND protocol>${c.protocol})))` : sql`true`}
    ORDER BY created_at, id, protocol LIMIT ${query.pageSize + 1}`);
  const selected = rows.slice(0, query.pageSize), last = selected.at(-1);
  return { items: selected.map((row) => { const d = row['document'] as Record<string, unknown>, iso = (key: string) => d[key] == null ? null : new Date(d[key] as string).toISOString(); return RuntimeAttemptFactSchema.parse({ ...d, createdAt: iso('createdAt'), startedAt: iso('startedAt'), endedAt: iso('endedAt') }); }),
    nextCursor: rows.length > query.pageSize && last ? JSON.stringify([1, 'business-attempts', scope, last['position_at'], last['id'], last['protocol']]) : null };
}
