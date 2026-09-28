import type { BusinessExecutionTaskItem, BusinessExecutionTaskQuery } from '@crewstation/contracts';
import { RuntimeTaskFactSchema, RuntimeAttemptFactSchema, type RuntimeFactQuery, type RuntimeFactPage, BusinessExecutionTaskPageSchema, BusinessExecutionTaskQuerySchema } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { BusinessTaskList } from '../../../ports/taskList';
import { taskListRows } from './rows';

const Cursor = z.strictObject({ version: z.literal(2), projectId: z.string().nullable(), state: BusinessExecutionTaskQuerySchema.shape.state.nullable(), rank: z.number().int().min(0).max(2), updatedAt: z.iso.datetime(), protocol: z.enum(['legacy', 'v3']), id: z.uuid() });
function readCursor(value: string | undefined, projectId: string | undefined, state: BusinessExecutionTaskQuery['state']) {
  if (!value) return undefined;
  try { const cursor = Cursor.parse(JSON.parse(Buffer.from(value, 'base64url').toString())); if (cursor.projectId !== (projectId ?? null) || cursor.state !== (state ?? null)) throw new Error('scope'); return cursor; }
  catch { throw validation('任务列表游标无效或筛选范围已改变'); }
}
/** Filter, attention ordering and keyset pagination happen in SQL over both protocols, before the bound. */
export function drizzleBusinessTaskList(db: Database): BusinessTaskList {
  return { list: async (input: BusinessExecutionTaskQuery) => {
    const query = BusinessExecutionTaskQuerySchema.parse(input), cursor = readCursor(query.cursor, query.projectId, query.state);
    const state = query.state === 'failed' ? sql`rank = 0` : query.state === 'unknown' ? sql`rank = 1` : query.state ? sql`state = ${query.state}` : sql`true`;
    const rows = await db.execute(sql`${taskListRows(query.projectId)}
      SELECT *, to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created,
        to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated
      FROM ranked WHERE ${state} AND ${cursor ? sql`(rank > ${cursor.rank} OR (rank = ${cursor.rank} AND
        (updated_at < ${cursor.updatedAt}::timestamptz OR (updated_at = ${cursor.updatedAt}::timestamptz AND
        (protocol > ${cursor.protocol} OR (protocol = ${cursor.protocol} AND id > ${cursor.id}))))))` : sql`true`}
      ORDER BY rank, updated_at DESC, protocol, id LIMIT ${query.limit + 1}`);
    const selected = rows.slice(0, query.limit);
    const items = selected.map((r) => ({
      id: String(r['id']), projectId: String(r['project_id']), serviceId: String(r['service_id']), callerIdentity: String(r['caller_identity']),
      protocol: r['protocol'] as 'legacy' | 'v3', state: String(r['state']), createdAt: String(r['created']), updatedAt: String(r['updated']),
      ...(r['message'] ? { message: String(r['message']) } : {}), labels: r['labels'] as Record<string, string>,
      attention: Number(r['rank']) === 0 ? 'failed' : Number(r['rank']) === 1 ? 'unknown' : 'none',
      failedSubtasks: Number(r['failed_count']), unknownSubtasks: Number(r['unknown_count']),
      ...(r['latest_failure'] ? { latestFailure: r['latest_failure'] as BusinessExecutionTaskItem['latestFailure'] } : {}),
    }));
    const last = selected.at(-1);
    return BusinessExecutionTaskPageSchema.parse({ items, ...(rows.length > query.limit && last ? { next: Buffer.from(JSON.stringify({ version: 2, projectId: query.projectId ?? null, state: query.state ?? null, rank: Number(last['rank']), updatedAt: String(last['updated']), protocol: last['protocol'], id: last['id'] })).toString('base64url') } : {}) });
  } };
}


/** Statistics use creation-time cohorts, independently of the operator attention queue. */
export async function readBusinessObservationFacts(db: Executor, query: RuntimeFactQuery): Promise<RuntimeFactPage> {
  const rows = await db.execute(sql`${taskListRows(query.projectId)} SELECT p.*,
    CASE WHEN protocol='legacy' THEN (SELECT closed_at FROM business_task.tasks t WHERE t.id=p.id)
      ELSE (SELECT closed_at FROM business_task.execution_logs l WHERE l.task_id=p.id) END AS closed_at,
    CASE WHEN protocol='legacy' THEN (SELECT trace_id FROM business_task.tasks t WHERE t.id=p.id)
      ELSE (SELECT intent->'task'->>'traceId' FROM business_task.execution_operations o WHERE o.kind='create-task' AND o.intent->'task'->>'id'=p.id LIMIT 1) END AS trace_id
    FROM parents p WHERE ${query.taskId ? sql`id=${query.taskId}` : sql`created_at >= ${query.from}::timestamptz AND created_at < ${query.to}::timestamptz`}
    ORDER BY created_at DESC, id LIMIT 201`);
  const selected = rows.slice(0, 200), ids = selected.map((row) => String(row['id']));
  if (!ids.length) return { items: [], partial: false };
  const children = await readObservationAttempts(db, ids), kept = children.slice(0, 2000);
  return { partial: rows.length > 200 || children.length > 2000, items: selected.map((row) => RuntimeTaskFactSchema.parse({
    id: row['id'], projectId: row['project_id'], serviceId: row['service_id'], protocol: row['protocol'], state: row['state'],
    name: (row['labels'] as Record<string, string> | null)?.['name'] ?? String(row['id']),
    createdAt: new Date(row['created_at'] as string).toISOString(), closedAt: row['closed_at'] ? new Date(row['closed_at'] as string).toISOString() : null,
    traceId: row['trace_id'] ?? null, attempts: kept.filter((attempt) => attempt.taskId === row['id']), attemptsPartial: children.length > 2000,
  })) };
}

async function readObservationAttempts(db: Executor, ids: string[]) {
  const selected = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const rows = await db.execute(sql`SELECT document FROM (
    SELECT jsonb_build_object('id',id,'taskId',task_id,'name',name,'kind',kind,'state',state,'attempt',attempt,
      'executionId',null,'agentId',null,'profileId',null,'profileRevision',null,
      'createdAt',created_at,'startedAt',started_at,'endedAt',ended_at) AS document, created_at, id
    FROM business_task.subtasks WHERE task_id IN (${selected})
    UNION ALL
    SELECT jsonb_build_object('id',id,'taskId',task_id,'name',view->>'name','kind',view->>'kind','state',view->>'state','attempt',view->'attempt',
      'executionId',view->>'executionId','agentId',view->>'agentProfileId','profileId',view->>'computeProfileId','profileRevision',view->'profileRevision',
      'createdAt',view->>'createdAt','startedAt',view->>'startedAt','endedAt',view->>'endedAt'), (view->>'createdAt')::timestamptz, id
    FROM business_task.execution_subtasks WHERE task_id IN (${selected})
  ) children ORDER BY created_at, id LIMIT 2001`);
  return rows.map((row) => {
    const d = row['document'] as Record<string, unknown>;
    const iso = (key: string) => d[key] === null || d[key] === undefined ? null : new Date(d[key] as string).toISOString();
    return RuntimeAttemptFactSchema.parse({ ...d, createdAt: iso('createdAt'), startedAt: iso('startedAt'), endedAt: iso('endedAt') });
  });
}
