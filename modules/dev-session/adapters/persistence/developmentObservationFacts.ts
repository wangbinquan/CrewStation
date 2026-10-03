import { sql } from 'drizzle-orm';
import { DevelopmentAgentIdentitySchema, RuntimeTaskFactSchema, RuntimeTaskHeaderFactSchema, type RuntimeFactQuery, type RuntimeFactPage, type RuntimeOwnerPageQuery, type RuntimeOwnerPage, type RuntimeTaskHeaderFact, type RuntimeAttemptFact } from '@crewstation/contracts';
import { conflict, jsonHash, validation } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { developmentAgentUsage as owners } from './developmentUsageTable';
import { agentStarts as starts } from './agentStartTable';

/** Only safe columns leave the owner. Never select a prompt, request or full prepared document. */
export async function readDevelopmentObservationFacts(db: Executor, query: RuntimeFactQuery): Promise<RuntimeFactPage> {
  if (query.sourceKind === 'business-task') return { items: [], partial: false };
  const rows = await developmentRows(db, query, 200);
  return { items: rows.slice(0, 200).map(developmentFact), partial: rows.length > 200 };
}

async function developmentRows(db: Executor, query: RuntimeFactQuery, pageSize: number, after?: { at: string; id: string }) {
  return db.execute(sql`SELECT o.execution_task_id, o.project_id, o.workspace_task_id, o.accepted_at,
    to_char(o.accepted_at::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS position_at,
    o.prepared->'intent'->'identity' AS identity, o.prepared->'price'->'identity' AS price_identity,
    o.prepared->'intent'->>'profileId' AS profile_id, o.prepared->'intent'->>'profileRevision' AS profile_revision,
    o.prepared->'intent'->'launch'->>'protocol' AS protocol, o.prepared->'price'->'profile' AS price_profile,
    o.prepared->'price'->>'acceptedAt' AS price_accepted_at,
    o.prepared->'context'->>'serviceId' AS service_id, o.prepared->'context'->>'traceId' AS trace_id,
    o.binding IS NOT NULL AS bound, o.close_reason,
    s.agent_id, s.task_id, s.execution_task_id AS start_execution_id, s.execution->>'taskId' AS execution_id,
    s.compute, s.compute_name, s.profile, s.state, s.cancelled, s.failure IS NOT NULL AS failed, s.logical_ending
    FROM ${owners} o LEFT JOIN ${starts} s ON s.execution_task_id=o.execution_task_id
    WHERE ${query.projectId ? sql`o.project_id=${query.projectId}` : sql`true`}
      AND ${query.taskId ? sql`o.execution_task_id=${query.taskId}` : sql`o.accepted_at::timestamptz >= ${query.from}::timestamptz AND o.accepted_at::timestamptz < ${query.to}::timestamptz`}
      AND (${after ? sql`o.accepted_at::timestamptz < ${after.at}::timestamptz OR (o.accepted_at::timestamptz=${after.at}::timestamptz AND o.execution_task_id>${after.id})` : sql`true`})
    ORDER BY o.accepted_at::timestamptz DESC, o.execution_task_id LIMIT ${pageSize + 1}`);
}

/** Complete original admission headers; page size does not restrict the cohort. */
export async function readDevelopmentObservationTaskPage(db: Executor, query: RuntimeOwnerPageQuery): Promise<RuntimeOwnerPage<RuntimeTaskHeaderFact>> {
  if (!Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 500) throw validation('开发运行事实每页大小无效');
  const { pageSize: _size, after, ...filters } = query, scope = jsonHash(filters);
  let position: { at: string; id: string } | undefined;
  if (after !== undefined) {
    let value: unknown; try { value = JSON.parse(after); } catch { throw validation('开发运行事实游标无效'); }
    if (!Array.isArray(value) || value.length !== 4 || value[0] !== 1 || value[1] !== scope || typeof value[2] !== 'string' || !Number.isFinite(Date.parse(value[2])) || typeof value[3] !== 'string' || !value[3]) throw validation('开发运行事实游标筛选范围已改变');
    position = { at: value[2], id: value[3] };
  }
  if (query.sourceKind === 'business-task') return { items: [], nextCursor: null };
  const rows = await developmentRows(db, query, query.pageSize, position), selected = rows.slice(0, query.pageSize), last = selected.at(-1);
  return { items: selected.map((row) => { const { attempts: _attempts, attemptsPartial: _partial, ...header } = developmentFact(row); return RuntimeTaskHeaderFactSchema.parse(header); }),
    nextCursor: rows.length > query.pageSize && last ? JSON.stringify([1, scope, last['position_at'], last['execution_task_id']]) : null };
}
/** The immutable original admission is one development execution and one original AgentStart. */
export async function readDevelopmentObservationAttemptPage(db: Executor, query: RuntimeOwnerPageQuery & { readonly taskId: string }): Promise<RuntimeOwnerPage<RuntimeAttemptFact>> {
  if (!Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 500) throw validation('开发运行事实每页大小无效');
  if (query.after !== undefined) throw validation('单开发执行的原 AgentStart 已结束，没有后续游标');
  if (query.sourceKind === 'business-task') return { items: [], nextCursor: null };
  const rows = await developmentRows(db, query, 1);
  if (rows.length > 1) throw conflict('开发执行的原受理身份不唯一');
  return { items: rows.length ? developmentFact(rows[0]!).attempts : [], nextCursor: null };
}

function developmentFact(row: Record<string, unknown>) {
  const identity = DevelopmentAgentIdentitySchema.parse(row['identity']);
  const profile = row['profile'] as { profileId?: string; revision?: number } | null;
  const price = row['price_profile'] as { id?: string; revision?: number; protocol?: string } | null;
  const revision = Number(row['profile_revision']);
  if (identity.projectId !== row['project_id'] || identity.taskId !== row['workspace_task_id'] || identity.taskId !== row['task_id'] ||
    identity.agentId !== row['agent_id'] || identity.executionId !== row['execution_task_id'] || identity.executionId !== row['start_execution_id'] || identity.executionId !== row['execution_id'] ||
    row['profile_id'] !== row['compute'] || profile?.profileId !== row['profile_id'] || profile?.revision !== revision ||
    price?.id !== row['profile_id'] || price?.revision !== revision || price?.protocol !== row['protocol'] ||
    row['accepted_at'] !== row['price_accepted_at'] || jsonHash(identity) !== jsonHash(DevelopmentAgentIdentitySchema.parse(row['price_identity']))) {
    throw conflict('开发观测事实与原受理身份或算力修订不一致');
  }
  const state = row['cancelled'] ? 'cancelled' : row['failed'] ? 'failed' : row['close_reason'] || row['logical_ending'] || row['state'] === 'ended' ? 'closed' : row['state'] === 'dispatched' ? 'running' : 'pending';
  const acceptedAt = new Date(String(row['accepted_at'])).toISOString();
  return RuntimeTaskFactSchema.parse({ id: identity.executionId, projectId: identity.projectId, serviceId: row['service_id'], name: identity.agentId,
    source: { kind: 'development-agent', identity, workspaceName: null }, protocol: 'development', state, createdAt: acceptedAt, closedAt: null, traceId: row['trace_id'] ?? null,
    attemptsPartial: false, attempts: [{ id: identity.agentId, taskId: identity.taskId, name: identity.agentId, kind: 'agent', state, attempt: 1,
      executionId: identity.executionId, agentId: identity.agentId, profileId: row['profile_id'], profileName: row['compute_name'] ?? null, profileRevision: revision,
      createdAt: acceptedAt, startedAt: null, endedAt: null }] });
}
