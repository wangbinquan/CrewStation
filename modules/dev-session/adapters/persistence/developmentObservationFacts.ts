import { sql } from 'drizzle-orm';
import { DevelopmentAgentIdentitySchema, RuntimeTaskFactSchema, type RuntimeFactQuery, type RuntimeFactPage } from '@crewstation/contracts';
import { conflict, jsonHash } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { developmentAgentUsage as owners } from './developmentUsageTable';
import { agentStarts as starts } from './agentStartTable';

/** Only safe columns leave the owner. Never select a prompt, request or full prepared document. */
export async function readDevelopmentObservationFacts(db: Executor, query: RuntimeFactQuery): Promise<RuntimeFactPage> {
  if (query.sourceKind === 'business-task') return { items: [], partial: false };
  const rows = await db.execute(sql`SELECT o.execution_task_id, o.project_id, o.workspace_task_id, o.accepted_at,
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
    ORDER BY o.accepted_at::timestamptz DESC, o.execution_task_id LIMIT 201`);
  return { items: rows.slice(0, 200).map(developmentFact), partial: rows.length > 200 };
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
