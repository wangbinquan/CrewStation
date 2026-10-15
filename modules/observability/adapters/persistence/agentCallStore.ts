// RFC-034 v2 §3/§5 —— Agent 执行记录的 PostgreSQL 实现。所有统计都是一次带索引的窗口扫描 + GROUP BY，
// 没有投影、缓存或触发器（与 agent-workflow RFC-371 v2 `infrastructure/callPersistence.ts` 同一形状）。
// 属于项目的写入先经 `observability.admit_project`：项目删除封写后拒绝新写入。

import type { ProjectId } from '@crewstation/contracts';
import type { Database, Executor } from '@crewstation/persistence';
import { sql, type SQL } from 'drizzle-orm';
import type { AgentCallStore, CallAggregate, CallFilter, CallGroup, CallModelRow, CallRow, CallScope, ModelAggregate } from '../../ports/agentCalls';
import { agentCallModels, agentCalls } from './tables';

const DAY_MS = 86_400_000;
/** 原生 SQL 里的时刻：postgres-js 不序列化 Date 参数，按 ISO 文本显式转 timestamptz（与仓内其他模块相同）。 */
const timestamp = (ms: number): SQL => sql`${new Date(ms).toISOString()}::timestamptz`;
type Raw = Record<string, unknown>;
const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value));
const text = (value: unknown): string => (value === null || value === undefined ? '0' : String(value));
const ms = (value: unknown): number | null => (value === null || value === undefined ? null : value instanceof Date ? value.getTime() : Date.parse(String(value)));

function scopeOf(scope: CallScope): SQL | undefined {
  if (scope.kind === 'project') return sql`c.project_id = ${scope.projectId}`;
  if (scope.kind === 'platform') return sql`c.project_id IS NULL`;
  return undefined;
}
function whereOf(filter: CallFilter, extra: readonly (SQL | undefined)[] = []): SQL {
  const parts = [
    filter.from === undefined ? undefined : sql`c.started_at >= ${timestamp(filter.from)}`,
    filter.to === undefined ? undefined : sql`c.started_at < ${timestamp(filter.to)}`,
    scopeOf(filter.scope), filter.source ? sql`c.source = ${filter.source}` : undefined, ...extra,
  ].filter((part): part is SQL => part !== undefined);
  return parts.length ? sql`WHERE ${sql.join(parts, sql` AND `)}` : sql``;
}

/** 每组的可加合计；Token 与人民币以文本返回再在进程内解析（sum(bigint) 是 numeric）。 */
const USAGE = sql`count(*)::int AS calls,
  count(*) FILTER (WHERE c.usage_state <> 'complete')::int AS incomplete_calls,
  count(*) FILTER (WHERE c.status IN ('failed','interrupted'))::int AS failed_calls,
  coalesce(sum(c.input_tokens),0)::text AS input, coalesce(sum(c.cache_read_tokens),0)::text AS cache_read,
  coalesce(sum(c.cache_write_tokens),0)::text AS cache_write, coalesce(sum(c.output_tokens),0)::text AS output,
  coalesce(sum(c.reasoning_tokens),0)::text AS reasoning, coalesce(sum(c.cost_nano),0)::text AS cost_nano,
  count(*) FILTER (WHERE c.cost_state IN ('unpriced','partial'))::int AS unpriced_calls,
  coalesce(sum(extract(epoch FROM (c.ended_at - c.started_at)) * 1000) FILTER (WHERE c.ended_at IS NOT NULL),0)::bigint::text AS duration_ms,
  count(DISTINCT c.task_id)::int AS tasks, count(DISTINCT c.agent_key)::int AS agents,
  min(c.started_at) AS first_started_at, max(c.ended_at) AS last_ended_at,
  count(*) FILTER (WHERE c.status = 'running')::int AS running`;

function groupKey(group: CallGroup, offsetMinutes: number): { key: SQL; label: SQL; where?: SQL } | null {
  switch (group) {
    case 'none': return null;
    case 'source': return { key: sql`c.source`, label: sql`NULL::text` };
    case 'status': return { key: sql`c.status`, label: sql`NULL::text` };
    case 'kind': return { key: sql`c.kind`, label: sql`NULL::text` };
    case 'day': {
      // 已校验的整数偏移直接内联，GROUP BY 与 SELECT 是同一个表达式。
      const offset = sql.raw(String(Math.trunc(offsetMinutes) * 60_000));
      return { key: sql`floor((extract(epoch FROM c.started_at) * 1000 + ${offset}) / ${sql.raw(String(DAY_MS))})::bigint::text`, label: sql`NULL::text` };
    }
    case 'task': return { key: sql`c.task_id`, label: sql`(array_agg(c.task_label ORDER BY c.started_at DESC))[1]` };
    case 'agent': return { key: sql`c.agent_key`, label: sql`(array_agg(c.agent_label ORDER BY c.started_at DESC))[1]` };
    case 'project': return { key: sql`c.project_id`, label: sql`NULL::text`, where: sql`c.project_id IS NOT NULL` };
  }
}

function aggregateRow(row: Raw): CallAggregate {
  return {
    key: row['key'] === null || row['key'] === undefined ? null : String(row['key']), label: (row['label'] as string | null) ?? null,
    source: (row['source'] as CallAggregate['source']) ?? null, projectId: (row['project_id'] as ProjectId | null) ?? null,
    calls: num(row['calls']), incompleteCalls: num(row['incomplete_calls']), failedCalls: num(row['failed_calls']), input: num(row['input']),
    cacheRead: num(row['cache_read']), cacheWrite: num(row['cache_write']), output: num(row['output']), reasoning: num(row['reasoning']),
    costNano: text(row['cost_nano']), unpricedCalls: num(row['unpriced_calls']), durationMs: num(row['duration_ms']), tasks: num(row['tasks']),
    agents: num(row['agents']), firstStartedAt: ms(row['first_started_at']), lastEndedAt: ms(row['last_ended_at']), running: num(row['running']),
  };
}

function callRow(row: typeof agentCalls.$inferSelect): CallRow {
  return {
    id: row.id, projectId: row.projectId as ProjectId | null, source: row.source, kind: row.kind, taskId: row.taskId, taskLabel: row.taskLabel,
    subtaskId: row.subtaskId, attempt: row.attempt, runtimeTaskId: row.runtimeTaskId, agentId: row.agentId, agentKey: row.agentKey, agentLabel: row.agentLabel,
    profileId: row.profileId, profileRevision: row.profileRevision, profileName: row.profileName, protocol: row.protocol, startedAt: row.startedAt.getTime(),
    status: row.status, endedAt: row.endedAt?.getTime() ?? null, usageState: row.usageState, input: row.inputTokens, cacheRead: row.cacheReadTokens,
    cacheWrite: row.cacheWriteTokens, output: row.outputTokens, reasoning: row.reasoningTokens, costNano: row.costNano.toString(), costState: row.costState,
  };
}
function modelRow(row: typeof agentCallModels.$inferSelect): CallModelRow {
  return {
    callId: row.callId, model: row.model, input: row.inputTokens, cacheRead: row.cacheReadTokens, cacheWrite: row.cacheWriteTokens,
    output: row.outputTokens, reasoning: row.reasoningTokens, costNano: row.costNano === null ? null : row.costNano.toString(), costState: row.costState,
  };
}

async function admit(db: Executor, projectId: string | null): Promise<void> {
  if (projectId !== null) await db.execute(sql`SELECT observability.admit_project(${projectId})`);
}

async function modelsOf(db: Executor, ids: readonly string[]): Promise<CallModelRow[]> {
  const rows: CallModelRow[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const found = await db.select().from(agentCallModels).where(sql`${agentCallModels.callId} IN (${sql.join(chunk.map((id) => sql`${id}::uuid`), sql`, `)})`)
      .orderBy(agentCallModels.callId, agentCallModels.model);
    rows.push(...found.map(modelRow));
  }
  return rows;
}

type Writes = Pick<AgentCallStore, 'insert' | 'running' | 'writeUsage' | 'end' | 'endRuntimeTask'>;
type Aggregates = Pick<AgentCallStore, 'aggregate' | 'aggregateModels' | 'durations' | 'taskPage'>;
type Lists = Pick<AgentCallStore, 'taskCalls' | 'recentCalls' | 'profileModels'>;

export function drizzleAgentCallStore(db: Database): AgentCallStore {
  return { ...callWrites(db), ...callAggregates(db), ...callLists(db) };
}

function callWrites(db: Database): Writes {
  return {
    insert: (call, at) => db.transaction(async (tx) => {
      await admit(tx, call.projectId);
      // 同一执行环境里同名 Agent 的新执行开始了：上一行不可能仍在运行，记为中断。
      await tx.execute(sql`UPDATE observability.agent_calls SET status='interrupted', ended_at=greatest(updated_at, started_at), updated_at=${timestamp(at)},
        usage_state=CASE WHEN usage_state='pending' THEN 'none' WHEN usage_state='complete' THEN 'partial' ELSE usage_state END
        WHERE runtime_task_id=${call.runtimeTaskId} AND agent_id=${call.agentId} AND status='running' AND id<>${call.id}::uuid`);
      await tx.insert(agentCalls).values({ ...call, startedAt: new Date(call.startedAt), updatedAt: new Date(at) }).onConflictDoNothing({ target: agentCalls.id });
    }),
    async running(target) {
      const [row] = await db.select({ id: agentCalls.id, projectId: agentCalls.projectId, profileId: agentCalls.profileId, startedAt: agentCalls.startedAt }).from(agentCalls)
        .where(sql`${agentCalls.runtimeTaskId} = ${target.runtimeTaskId} AND ${agentCalls.agentId} = ${target.agentId} AND ${agentCalls.status} = 'running'`);
      return row ? { id: row.id, projectId: row.projectId as ProjectId | null, profileId: row.profileId, startedAt: row.startedAt.getTime() } : null;
    },
    writeUsage: (callId, write) => db.transaction(async (tx) => {
      const [current] = await tx.execute<{ status: string; project_id: string | null }>(sql`SELECT status, project_id FROM observability.agent_calls WHERE id=${callId}::uuid FOR UPDATE`);
      if (current?.status !== 'running') return false;
      await admit(tx, current.project_id);
      await tx.delete(agentCallModels).where(sql`${agentCallModels.callId} = ${callId}::uuid`);
      if (write.models.length) await tx.insert(agentCallModels).values(write.models.map((row) => ({
        callId, model: row.model, inputTokens: row.input, cacheReadTokens: row.cacheRead, cacheWriteTokens: row.cacheWrite, outputTokens: row.output,
        reasoningTokens: row.reasoning, priceId: row.priceId, costNano: row.costNano, costState: row.costState,
      })));
      await tx.update(agentCalls).set({
        usageState: write.usageState, inputTokens: write.totals.input, cacheReadTokens: write.totals.cacheRead, cacheWriteTokens: write.totals.cacheWrite,
        outputTokens: write.totals.output, reasoningTokens: write.totals.reasoning, costNano: write.costNano, costState: write.costState, updatedAt: new Date(write.updatedAt),
        ...(write.end ? { status: write.end.status, endedAt: new Date(write.end.endedAt) } : {}),
      }).where(sql`${agentCalls.id} = ${callId}::uuid`);
      return true;
    }),
    end: (callId, end, at) => db.transaction(async (tx) => {
      const [current] = await tx.execute<{ status: string; project_id: string | null }>(sql`SELECT status, project_id FROM observability.agent_calls WHERE id=${callId}::uuid FOR UPDATE`);
      if (current?.status !== 'running') return;
      await admit(tx, current.project_id);
      await tx.execute(sql`UPDATE observability.agent_calls SET status=${end.status}, ended_at=${timestamp(end.endedAt)}, updated_at=${timestamp(at)},
        usage_state=CASE WHEN usage_state='pending' THEN 'none' WHEN usage_state='complete' AND ${end.status}::text IN ('canceled','interrupted') THEN 'partial' ELSE usage_state END
        WHERE id=${callId}::uuid`);
    }),
    async endRuntimeTask(runtimeTaskId, end, at) {
      const rows = await db.execute<{ id: string }>(sql`UPDATE observability.agent_calls SET status=${end.status}, ended_at=greatest(${timestamp(end.endedAt)}, started_at), updated_at=${timestamp(at)},
        usage_state=CASE WHEN usage_state='pending' THEN 'none' WHEN usage_state='complete' THEN 'partial' ELSE usage_state END
        WHERE runtime_task_id=${runtimeTaskId} AND status='running' RETURNING id`);
      return rows.length;
    },
  };
}

function callAggregates(db: Database): Aggregates {
  return {
    async aggregate(filter, group, dayOffsetMinutes = 0) {
      const grouping = groupKey(group, dayOffsetMinutes);
      if (!grouping) {
        const rows = await db.execute<Raw>(sql`SELECT NULL::text AS key, NULL::text AS label, NULL::text AS source, NULL::text AS project_id, ${USAGE} FROM observability.agent_calls c ${whereOf(filter)}`);
        return rows.filter((row) => num(row['calls']) > 0).map(aggregateRow);
      }
      const rows = await db.execute<Raw>(sql`SELECT ${grouping.key} AS key, ${grouping.label} AS label, min(c.source) AS source, min(c.project_id) AS project_id, ${USAGE}
        FROM observability.agent_calls c ${whereOf(filter, [grouping.where])} GROUP BY ${grouping.key}`);
      return rows.map(aggregateRow);
    },
    async aggregateModels(filter) {
      const rows = await db.execute<Raw>(sql`SELECT c.profile_id, (array_agg(c.profile_name ORDER BY c.started_at DESC))[1] AS profile_name, max(c.protocol) AS protocol, m.model,
        count(DISTINCT c.id)::int AS calls, count(DISTINCT c.id) FILTER (WHERE c.usage_state <> 'complete')::int AS incomplete_calls,
        count(DISTINCT c.id) FILTER (WHERE c.status IN ('failed','interrupted'))::int AS failed_calls,
        sum(m.input_tokens)::text AS input, sum(m.cache_read_tokens)::text AS cache_read, sum(m.cache_write_tokens)::text AS cache_write,
        sum(m.output_tokens)::text AS output, sum(m.reasoning_tokens)::text AS reasoning, coalesce(sum(m.cost_nano),0)::text AS cost_nano,
        count(*) FILTER (WHERE m.cost_state IN ('unpriced','partial') AND m.input_tokens + m.cache_read_tokens + m.cache_write_tokens + m.output_tokens > 0)::int AS unpriced_calls
        FROM observability.agent_call_models m JOIN observability.agent_calls c ON c.id = m.call_id ${whereOf(filter)} GROUP BY c.profile_id, m.model`);
      return rows.map((row): ModelAggregate => ({
        profileId: String(row['profile_id']), profileName: (row['profile_name'] as string | null) ?? null, protocol: String(row['protocol'] ?? ''), model: String(row['model']),
        calls: num(row['calls']), incompleteCalls: num(row['incomplete_calls']), failedCalls: num(row['failed_calls']), input: num(row['input']), cacheRead: num(row['cache_read']),
        cacheWrite: num(row['cache_write']), output: num(row['output']), reasoning: num(row['reasoning']), costNano: text(row['cost_nano']), unpricedCalls: num(row['unpriced_calls']),
      }));
    },
    async durations(filter) {
      const [row] = await db.execute<Raw>(sql`SELECT count(*)::int AS samples, percentile_disc(0.5) WITHIN GROUP (ORDER BY d) AS p50,
        percentile_disc(0.95) WITHIN GROUP (ORDER BY d) AS p95, max(d) AS max
        FROM (SELECT (extract(epoch FROM (c.ended_at - c.started_at)) * 1000)::bigint AS d FROM observability.agent_calls c ${whereOf(filter, [sql`c.ended_at IS NOT NULL`])}) s`);
      const value = (key: string) => (row?.[key] === null || row?.[key] === undefined ? null : Number(row[key]));
      return { samples: num(row?.['samples']), p50: value('p50'), p95: value('p95'), max: value('max') };
    },
    async taskPage(query) {
      const escaped = query.q?.replace(/[\\%_]/g, (char) => '\\' + char);
      const match = query.q ? sql`bool_or(c.task_label ILIKE ${'%' + escaped + '%'} OR c.task_id = ${query.q})` : undefined;
      const after = query.after ? sql`(min(c.started_at), c.task_id) < (${timestamp(query.after.firstStartedAt)}, ${query.after.taskId})` : undefined;
      const having = [match, after].filter((part): part is SQL => part !== undefined);
      const rows = await db.execute<Raw>(sql`SELECT c.task_id AS key, (array_agg(c.task_label ORDER BY c.started_at DESC))[1] AS label, min(c.source) AS source,
        min(c.project_id) AS project_id, ${USAGE} FROM observability.agent_calls c ${whereOf(query.filter)} GROUP BY c.task_id
        ${having.length ? sql`HAVING ${sql.join(having, sql` AND `)}` : sql``} ORDER BY min(c.started_at) DESC, c.task_id DESC LIMIT ${query.limit}`);
      return rows.map(aggregateRow);
    },
  };
}

function callLists(db: Database): Lists {
  const selectCalls = (where: SQL, order: SQL, limit: number) => db.select().from(agentCalls).where(where).orderBy(order).limit(limit);
  return {
    async taskCalls(taskId, scope, limit) {
      const found = await selectCalls(sql`${agentCalls.taskId} = ${taskId}${scope.kind === 'project' ? sql` AND ${agentCalls.projectId} = ${scope.projectId}` : scope.kind === 'platform' ? sql` AND ${agentCalls.projectId} IS NULL` : sql``}`,
        sql`${agentCalls.startedAt} ASC, ${agentCalls.id} ASC`, limit + 1);
      const calls = found.slice(0, limit).map(callRow);
      return { calls, models: await modelsOf(db, calls.map((call) => call.id)), truncated: found.length > limit };
    },
    async recentCalls(filter, before, limit) {
      const keyset = before ? sql`(c.started_at, c.id) < (${timestamp(before.startedAt)}, ${before.id}::uuid)` : undefined;
      const ids = await db.execute<{ id: string }>(sql`SELECT c.id FROM observability.agent_calls c ${whereOf(filter, [keyset])} ORDER BY c.started_at DESC, c.id DESC LIMIT ${limit}`);
      if (!ids.length) return { calls: [], models: [] };
      const found = await selectCalls(sql`${agentCalls.id} IN (${sql.join(ids.map((row) => sql`${row.id}::uuid`), sql`, `)})`, sql`${agentCalls.startedAt} DESC, ${agentCalls.id} DESC`, limit);
      const calls = found.map(callRow);
      return { calls, models: await modelsOf(db, calls.map((call) => call.id)) };
    },
    async profileModels() {
      const rows = await db.execute<{ profile_id: string; model: string; calls: number }>(sql`SELECT c.profile_id, m.model, count(DISTINCT c.id)::int AS calls
        FROM observability.agent_call_models m JOIN observability.agent_calls c ON c.id = m.call_id WHERE m.model <> '' GROUP BY c.profile_id, m.model`);
      return rows.map((row) => ({ profileId: row.profile_id, model: row.model, calls: num(row.calls) }));
    },
  };
}
