import { and, eq, sql } from 'drizzle-orm';
import { BusinessFinalizationDtoSchema, ResourceIdSchema } from '@crewstation/contracts';
import { conflict, jsonHash, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { FinalizationOperation } from '../../../domain/finalization/operation';
import type { FinalizationOperations } from '../../../ports/storage/finalizations';
import { authorizeStoppingExecution, executionTransaction } from '../executionTransaction';
import { executionOperations } from '../executionTables';
import { executionTaskStates } from '../execution/lifecycleTables';
import { executionLogs } from '../execution/projectionTables';
import { appendTaskState } from '../execution/logEvents';
import { finalizations } from './tables';

export function acceptFinalization(db: Database): FinalizationOperations['accept'] {
  return (serviceId, taskId, input, admission) => executionTransaction(db, serviceId, async (tx, now) => {
    const { requestKey, fence: _fence, stopAuthority: _stop, ...parameters } = input, digest = jsonHash(parameters);
    const prior = (await tx.select().from(finalizations).where(and(eq(finalizations.taskId, taskId), eq(finalizations.serviceId, serviceId))))[0]?.body;
    if (prior) {
      if (prior.requestKey !== requestKey || prior.requestDigest !== digest) throw conflict('任务已有不同的终结请求', { code: 'idempotency_conflict' });
      return prior;
    }
    const parent = (await tx.select().from(executionOperations).where(and(eq(executionOperations.serviceId, serviceId), sql`${executionOperations.intent}->'task'->>'id' = ${taskId}`)))[0];
    if (!parent) throw notFound('业务任务', taskId);
    if (parent.intent.task.completionPolicy !== 'archive-and-delete') throw precondition('旧策略任务须沿用原生命周期', { code: 'finalization_policy_required' });
    if (!['succeeded', 'failed'].includes(parent.state)) throw precondition('任务准入尚未确定，不能终结', { code: 'task_admission_pending' });
    const current = (await tx.select().from(executionTaskStates).where(eq(executionTaskStates.taskId, taskId)))[0];
    const generation = current?.generation ?? parent.intent.task.generation;
    if (current?.operationId || generation !== input.expectedGeneration) throw conflict('任务世代已变化或正在变更', { code: 'stale_generation' });
    if (current?.state === 'closed') throw conflict('任务已经关闭', { code: 'task_closed' });
    ResourceIdSchema.parse(admission.spaceId);
    const authorization = admission.authorization;
    const acceptedBy: FinalizationOperation['acceptedBy'] = 'administrative' in authorization ? { type: 'user', ...authorization.administrative }
      : { type: 'service', podUid: authorization.source.podUid, epoch: await authorizeStoppingExecution(tx, serviceId, parent.intent.tasksSpec.executionControl === 'fenced', authorization, now) };
    const id = newResourceId(), taskGeneration = generation + 1;
    const view = BusinessFinalizationDtoSchema.parse({ operationId: id, taskId, revision: 1, taskGeneration, outcome: input.outcome, phase: 'requested', phaseState: 'pending',
      errorCode: null, message: null, retryable: false, nextRetryAt: null, receipt: null, computeStopped: false, artifactsReady: false, volumeDisposition: 'pending', storageReclaimed: null, createdAt: now.toISOString(), updatedAt: now.toISOString() });
    const operation: FinalizationOperation = { id, serviceId: parent.intent.task.serviceId, projectId: parent.intent.projectId, requestKey, requestDigest: digest, expectedGeneration: generation,
      spaceId: admission.spaceId, volumeUid: admission.volumeUid, archive: input.archive, acceptedBy, view, evidence: {}, sequence: 0, lease: null };
    await tx.insert(finalizations).values({ id, serviceId, taskId, phase: view.phase, body: operation, nextAttemptAt: now });
    await recordFinalizationTaskState(tx, operation, now);
    return operation;
  });
}
/** Finalization/audit state is durable independently of the seven-day event stream. Expired streams stay expired. */
export async function recordFinalizationTaskState(tx: Executor, operation: FinalizationOperation, now: Date): Promise<void> {
  const taskId = operation.view.taskId, state = operation.view.phase === 'completed' ? 'closed' : 'finalizing';
  const value = { serviceId: operation.serviceId, generation: operation.view.taskGeneration, state, operationId: state === 'closed' ? null : operation.id };
  await tx.insert(executionTaskStates).values({ taskId, ...value }).onConflictDoUpdate({ target: executionTaskStates.taskId, set: value });
  const log = (await tx.select().from(executionLogs).where(eq(executionLogs.taskId, taskId)))[0];
  if (!log?.expired) await appendTaskState(tx, operation.serviceId, taskId, state, value.generation, `finalization:${operation.id}:${state}`, now);
}
