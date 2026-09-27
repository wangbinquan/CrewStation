import { migrationControlRepository } from './migrationControl';
import { executionMessages } from './messages/tables';
import { executionLifecycles as lifecycles, executionTaskStates as taskStates } from './execution/lifecycleTables';
import { executionCancellations as cancels } from './execution/cancellationTables';
import { executionSubtasks } from './execution/subtaskTables';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { conflict, newResourceId, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { ExecutionControl } from '../../domain/executionControl';
import { liveControl, nextEpoch } from '../../domain/executionControl';
import { activateControl, claimControl, prepareHandoff, releaseControl, renewControl } from '../../domain/controlTransitions';
import type { ExecutionControls, FreezeExecutionInput } from '../../ports/executionControl';
import { executionControls as controls, executionOperations as ops } from './executionTables';
import { executionNow, executionTransaction, readExecutionControl } from './executionTransaction';
import { legacyMutationsQuiescent } from './legacyMutations';

export async function dispatchQuiescent(tx: Executor, serviceId: string): Promise<boolean> {
  if ((await tx.select({ id: executionMessages.id }).from(executionMessages).where(and(eq(executionMessages.serviceId, serviceId), inArray(executionMessages.state, ['dispatching', 'unknown']))).limit(1)).length) return false;
  if ((await tx.select({ id: lifecycles.id }).from(lifecycles).where(and(eq(lifecycles.serviceId, serviceId), eq(lifecycles.dispatched, true), inArray(lifecycles.state, ['pending', 'running']))).limit(1)).length) return false;
  if (!(await legacyMutationsQuiescent(tx, serviceId))) return false;
  if ((await tx.select({ id: cancels.id }).from(cancels).where(and(eq(cancels.serviceId, serviceId), or(eq(cancels.state, 'dispatching'), and(eq(cancels.state, 'pending'), eq(cancels.errorCode, 'cancellation_unconfirmed'))))).limit(1)).length) return false;
  if ((await tx.select({ id: executionSubtasks.id }).from(executionSubtasks).where(and(eq(executionSubtasks.serviceId, serviceId), or(inArray(executionSubtasks.dispatch, ['dispatching', 'unknown']), and(eq(executionSubtasks.runtimeDispatched, true), eq(executionSubtasks.runtimeAdmitted, false))))).limit(1)).length) return false;
  return !(await tx.select({ id: ops.id }).from(ops).where(and(eq(ops.serviceId, serviceId), or(eq(ops.state, 'running'), and(eq(ops.errorCode, 'admission_unknown'), eq(ops.state, 'pending'))))).limit(1)).length;
}
function existing(value: ExecutionControl | undefined): ExecutionControl {
  if (!value) throw precondition('服务尚未申请执行权');
  return value;
}
function frozenControl(current: ExecutionControl, input: FreezeExecutionInput): ExecutionControl {
  if (current.handoff?.operationId === input.operationId) {
    if (current.handoff.expectedActiveReleaseId !== input.expectedActiveReleaseId || current.handoff.targetReleaseId !== input.targetReleaseId || current.handoff.targetSlot !== input.targetSlot) throw conflict('交接 ID 已用于不同目标或来源');
    return current;
  }
  if (current.migration && (current.migration.targetReleaseId !== input.targetReleaseId || !current.migration.preparationDigest)) throw precondition('迁移停写屏障只允许交接到已确认的目标版本');
  if (current.handoff && current.handoff.stage !== 'complete') throw conflict('服务有未完成的交接');
  if (current.activeReleaseId !== input.expectedActiveReleaseId) throw conflict('在线发布已变化', { code: 'stale_generation' });
  return { ...current, migration: undefined, epoch: nextEpoch(current.epoch), phase: 'frozen', leaseId: null, leaseOwner: null, leasePodUid: null, leaseExpiresAt: null, preparationDigest: null,
    handoff: { operationId: input.operationId, expectedActiveReleaseId: input.expectedActiveReleaseId, targetReleaseId: input.targetReleaseId, targetSlot: input.targetSlot, stage: 'frozen' } };
}

export function drizzleExecutionControls(db: Database): ExecutionControls {
  const update = (serviceId: string, fn: (current: ExecutionControl | undefined, now: Date, tx: Executor) => Promise<ExecutionControl> | ExecutionControl) => executionTransaction(db, serviceId, async (tx, now) => {
    const control = await fn(await readExecutionControl(tx, serviceId), now, tx);
    await tx.insert(controls).values({ serviceId, body: control }).onConflictDoUpdate({ target: controls.serviceId, set: { body: control } });
    return { control, now };
  });
  return {
    ...migrationControlRepository(db),
    activeTaskContracts: async (serviceId) => {
      const active = await db.select({ intent: ops.intent }).from(ops).leftJoin(taskStates, sql`${ops.intent}->'task'->>'id' = ${taskStates.taskId}`).where(and(eq(ops.serviceId, serviceId), inArray(ops.state, ['pending', 'running', 'succeeded', 'retryable-rejected']), sql`COALESCE(${taskStates.state}, '') <> 'closed'`));
      return active.map(({ intent }) => ({ taskId: intent.task.id, taskContractVersion: intent.task.taskContractVersion }));
    },
    quiescent: (id) => dispatchQuiescent(db, id),
    read: async (serviceId) => ({ control: await readExecutionControl(db, serviceId), now: await executionNow(db) }),
    claim: (id, source, input) => update(id, async (current, now, tx) => {
      if (!current && !(await legacyMutationsQuiescent(tx, id))) throw precondition('旧业务接口仍有在途或结果未知的写操作', { code: 'legacy_dispatch_in_flight' });
      if (current?.handoff && current.handoff.stage !== 'complete' && !(await dispatchQuiescent(tx, id))) throw precondition('原世代派发仍在对账', { code: 'dispatch_in_flight' });
      return claimControl(id, current, source, input.instanceId, newResourceId(), now);
    }),
    renew: (id, source, input) => update(id, (current, now) => renewControl(existing(current), source, input, now)),
    release: (id, source, input) => update(id, (current, now) => releaseControl(existing(current), source, input, now)),
    activate: (id, source, input) => update(id, (current, now) => activateControl(existing(current), source, input, now)),
    freeze: async (id, input) => {
      const snapshot = await update(id, (current) => frozenControl(current ?? { serviceId: id, activeReleaseId: input.expectedActiveReleaseId, physicalSlot: input.targetSlot === 'blue' ? 'green' : 'blue', epoch: 1, phase: 'inactive', leaseId: null, leaseOwner: null, leasePodUid: null, leaseExpiresAt: null, preparationDigest: null }, input));
      return { ...snapshot, quiescent: await dispatchQuiescent(db, id) };
    },
    handoffReady: (id, source, input) => update(id, async (current, now, tx) => {
      const active = await tx.select({ intent: ops.intent }).from(ops).leftJoin(taskStates, sql`${ops.intent}->'task'->>'id' = ${taskStates.taskId}`).where(and(eq(ops.serviceId, id), inArray(ops.state, ['pending', 'running', 'succeeded']), sql`COALESCE(${taskStates.state}, '') <> 'closed'`));
      // 已确认关闭的父任务不再阻挡新版本契约交接。
      if (active.some(({ intent }) => !input.acceptedTaskContractVersions.includes(intent.task.taskContractVersion))) throw precondition('目标不支持现有任务契约', { code: 'task_contract_unsupported' });
      return prepareHandoff(existing(current), source, input, now);
    }),
    routeObserved: (id, operationId, releaseId, slot) => update(id, (value, now) => {
      const current = existing(value), handoff = current.handoff;
      if (!handoff || handoff.operationId !== operationId || handoff.targetReleaseId !== releaseId || handoff.targetSlot !== slot) throw conflict('路由观测与交接目标不一致');
      if (!['prepared', 'routed', 'complete'].includes(handoff.stage)) throw precondition('尚未完成应用准备屏障');
      if (handoff.stage !== 'complete' && (!current.preparationDigest || !liveControl(current, now))) throw precondition('目标准备租约已失效，请重新准备');
      return handoff.stage === 'complete' ? current : { ...current, handoff: { ...handoff, stage: 'routed' } };
    }),
  };
}
