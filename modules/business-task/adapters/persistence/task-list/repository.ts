import type { BusinessExecutionTaskItem, BusinessExecutionTaskQuery } from '@crewstation/contracts';
import { BusinessExecutionTaskPageSchema, BusinessExecutionTaskQuerySchema } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { BusinessTaskList } from '../../../ports/taskList';
import { taskListRows } from './rows';

const Cursor = z.strictObject({ version: z.literal(1), projectId: z.string().nullable(), rank: z.number().int().min(0).max(2), updatedAt: z.iso.datetime(), protocol: z.enum(['legacy', 'v3']), id: z.uuid() });
function readCursor(value: string | undefined, projectId: string | undefined) {
  if (!value) return undefined;
  try { const cursor = Cursor.parse(JSON.parse(Buffer.from(value, 'base64url').toString())); if (cursor.projectId !== (projectId ?? null)) throw new Error('scope'); return cursor; }
  catch { throw validation('任务列表游标无效或筛选范围已改变'); }
}
/** Filter, attention ordering and keyset pagination happen in SQL over both protocols, before the bound. */
export function drizzleBusinessTaskList(db: Database): BusinessTaskList {
  return { list: async (input: BusinessExecutionTaskQuery) => {
    const query = BusinessExecutionTaskQuerySchema.parse(input), cursor = readCursor(query.cursor, query.projectId);
    const rows = await db.execute(sql`${taskListRows(query.projectId)}
      SELECT *, to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created,
        to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated
      FROM ranked WHERE ${cursor ? sql`(rank > ${cursor.rank} OR (rank = ${cursor.rank} AND
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
    return BusinessExecutionTaskPageSchema.parse({ items, ...(rows.length > query.limit && last ? { next: Buffer.from(JSON.stringify({ version: 1, projectId: query.projectId ?? null, rank: Number(last['rank']), updatedAt: String(last['updated']), protocol: last['protocol'], id: last['id'] })).toString('base64url') } : {}) });
  } };
}
