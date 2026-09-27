import { and, asc, desc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import type { BusinessRecoveryClaimReceipt } from '@crewstation/contracts';
import { RequestBusinessRecoverySchema } from '@crewstation/contracts';
import { conflict, newResourceId, precondition } from '@crewstation/kernel';
import { jsonHash } from '@crewstation/kernel';
import type { RecoveryAdmission, TaskRecoveryRequests } from '../../../ports/taskRecovery';
import type { ExecutionAuthorization } from '../../../domain/executionControl';
import { assertExecutionFence } from '../../../domain/executionControl';
import { executionTransaction, readExecutionControl } from '../executionTransaction';
import { assertRecoveryTarget, recoveryCapability, recoveryCapabilities } from './admission';
import { auditRecovery, ownedRecovery } from './ownership';
import { authorizeRecoveryMutation } from './mutations';
import { reconcileRecoveryRequests } from './progress';
import { recoveryRequests as requests, recoveryView } from './tables';

const active = ['pending', 'claimed', 'running'] as const;
export function drizzleTaskRecoveryRequests(db: Database): TaskRecoveryRequests {
  return {
    request: (input) => requestRecovery(db, input),
    authorize: (serviceId, mutation, authorization) => executionTransaction(db, serviceId, async (tx, now) => { await authorizeRecoveryMutation(tx, now, serviceId, mutation, authorization); }),
    reconcile: () => reconcileRecoveryRequests(db),
    get: async (serviceId, id) => { const row = (await db.select().from(requests).where(and(eq(requests.serviceId, serviceId), eq(requests.id, id))))[0]; return row && recoveryView(row); },
    list: async (serviceId, taskId, limit) => (await db.select().from(requests).where(and(eq(requests.serviceId, serviceId), eq(requests.taskId, taskId))).orderBy(desc(requests.createdAt), desc(requests.id)).limit(Math.max(1, Math.min(100, Math.trunc(limit) || 30)))).map(recoveryView),
    claim: (serviceId, authorization, id) => claimRecovery(db, serviceId, authorization, id),
    reject: (serviceId, id, ownership, reason) => executionTransaction(db, serviceId, async (tx, now) => {
      const row = await ownedRecovery(tx, now, serviceId, id, ownership);
      if (row.state !== 'claimed') throw conflict('已开始执行的恢复请求不能由应用改写结果');
      if (!reason.trim() || reason.length > 1024) throw precondition('拒绝恢复必须提供有界原因');
      const updated = (await tx.update(requests).set({ state: 'rejected', reason, claimId: null, leaseUntil: null, updatedAt: now }).where(eq(requests.id, id)).returning())[0]!;
      await auditRecovery(tx, now, id, 'rejected', ownership.authorization.fence!.instanceId, row.claimEpoch);
      return recoveryView(updated);
    }),
  };
}
async function requestRecovery(db: Database, input: RecoveryAdmission) {
  const request = RequestBusinessRecoverySchema.parse(input.request), digest = jsonHash(request);
  return executionTransaction(db, input.serviceId, async (tx, now) => {
    const old = (await tx.select().from(requests).where(and(eq(requests.serviceId, input.serviceId), eq(requests.requestKey, request.requestKey))))[0];
    if (old) { if (old.requestDigest !== digest || old.projectId !== input.projectId) throw conflict('同一恢复 requestKey 已用于不同内容', { code: 'idempotency_conflict' }); return recoveryView(old); }
    if (input.assessmentDigest !== request.assessmentDigest) throw precondition('恢复评估已经变化', { code: 'recovery_assessment_stale' });
    await recoveryCapability(tx, input.serviceId, request.target.action, now, input.controlEpoch);
    await assertRecoveryTarget(tx, input.serviceId, input.projectId, request.target);
    const targetKey = 'subtaskId' in request.target ? request.target.subtaskId : '';
    if ((await tx.select({ id: requests.id }).from(requests).where(and(eq(requests.serviceId, input.serviceId), eq(requests.taskId, request.target.taskId), eq(requests.targetKey, targetKey), inArray(requests.state, [...active]))).limit(1)).length) throw conflict('该任务已有未完成恢复请求', { code: 'recovery_in_progress' });
    const row = (await tx.insert(requests).values({ id: newResourceId(), serviceId: input.serviceId, projectId: input.projectId, taskId: request.target.taskId, targetKey,
      requestKey: request.requestKey, requestDigest: digest, requestedBy: input.requestedBy, target: request.target, assessmentDigest: request.assessmentDigest, state: 'pending', createdAt: now, updatedAt: now }).returning())[0]!;
    await auditRecovery(tx, now, row.id, 'requested', input.requestedBy, null);
    return recoveryView(row);
  });
}
async function claimRecovery(db: Database, serviceId: string, authorization: ExecutionAuthorization, id?: string): Promise<BusinessRecoveryClaimReceipt | undefined> {
  return executionTransaction(db, serviceId, async (tx, now) => {
    const control = await readExecutionControl(tx, serviceId), epoch = assertExecutionFence(control, authorization, now);
    const actions = await recoveryCapabilities(tx, serviceId, now);
    if (!actions.length) throw precondition('当前应用版本未声明恢复能力', { code: 'application_recovery_unsupported' });
    const available = or(eq(requests.state, 'pending'), and(inArray(requests.state, ['claimed', 'running']), or(lte(requests.leaseUntil, now), sql`${requests.claimEpoch} <> ${epoch}`)));
    const row = (await tx.select().from(requests).where(and(eq(requests.serviceId, serviceId), available, id ? eq(requests.id, id) : inArray(sql`${requests.target}->>'action'`, actions))).orderBy(asc(requests.createdAt), asc(requests.id)).limit(1).for('update', { skipLocked: true }))[0];
    if (!row) return undefined;
    await recoveryCapability(tx, serviceId, row.target.action, now);
    const claimId = newResourceId(), expires = new Date(Math.min(now.getTime() + 30_000, Date.parse(control!.leaseExpiresAt!)));
    const updated = (await tx.update(requests).set({ state: row.state === 'running' ? 'running' : 'claimed', claimId, claimEpoch: epoch, claimHolder: authorization.fence!.instanceId, claimPodUid: authorization.source.podUid, leaseUntil: expires, updatedAt: now }).where(eq(requests.id, row.id)).returning())[0]!;
    await auditRecovery(tx, now, row.id, 'claimed', authorization.fence!.instanceId, epoch);
    return { request: recoveryView(updated), claimId, expiresAt: expires.toISOString() };
  });
}
