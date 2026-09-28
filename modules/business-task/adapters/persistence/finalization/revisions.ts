import { and, eq, gt } from 'drizzle-orm';
import { conflict, jsonHash, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { FinalizationOperations } from '../../../ports/storage/finalizations';
import type { FinalizationOperation } from '../../../domain/finalization/operation';
import type { FinalizationRevision } from '../../../domain/finalization/revision';
import { authorizeExecution, executionTransaction } from '../executionTransaction';
import { finalizationRevisions, finalizations } from './tables';

export function finalizationRevisionOperations(db: Database): Pick<FinalizationOperations, 'revise' | 'revision' | 'settleRevision'> {
  return {
    revision: async (id) => (await db.select().from(finalizationRevisions).where(eq(finalizationRevisions.id, id)))[0]?.body,
    revise: (serviceId, taskId, input, authorization) => executionTransaction(db, serviceId, async (tx, now) => {
      const op = (await tx.select().from(finalizations).where(and(eq(finalizations.serviceId, serviceId), eq(finalizations.taskId, taskId))).for('update'))[0]?.body;
      if (!op) throw notFound('终结操作');
      const { fence: _fence, ...request } = input, digest = jsonHash(request);
      const prior = (await tx.select().from(finalizationRevisions).where(and(eq(finalizationRevisions.finalizationId, op.id), eq(finalizationRevisions.requestKey, input.requestKey))))[0]?.body;
      if (prior) { if (prior.digest !== digest) throw conflict('同一修订请求键已用于不同内容', { code: 'idempotency_conflict' }); return prior; }
      if (input.expectedGeneration !== op.view.taskGeneration || input.expectedRevision !== op.view.revision) throw conflict('任务或终结修订已变化', { code: 'stale_generation' });
      if (!['requested', 'draining', 'archiving'].includes(op.view.phase) || op.view.receipt || op.view.phaseState === 'revising') throw precondition('当前终结阶段不可修订清单', { code: 'finalization_revision_unavailable' });
      if (op.volumeUid === null && !op.evidence.volumeIdentityConfirmed) throw precondition('工作卷身份尚未确认，暂不能绑定清单修订', { code: 'workspace_volume_identity_pending' });
      const actor = 'administrative' in authorization ? authorization.administrative : { podUid: authorization.source.podUid, epoch: await authorizeExecution(tx, serviceId, true, authorization, now) };
      const change: FinalizationRevision = { id: newResourceId(), finalizationId: op.id, projectId: op.projectId, serviceId: op.serviceId, spaceId: op.spaceId, taskId, input: request, actor, digest, state: 'pending', createdAt: now.toISOString(), updatedAt: now.toISOString() };
      await tx.insert(finalizationRevisions).values({ id: change.id, finalizationId: op.id, requestKey: input.requestKey, body: change });
      const body = { ...op, revisionRequestId: change.id, sequence: op.sequence + 1, lease: null, view: { ...op.view, phaseState: 'revising' as const, retryable: false, errorCode: null, message: '等待归档清单修订确认', updatedAt: now.toISOString() } };
      await tx.update(finalizations).set({ body, sequence: body.sequence, leaseOwner: null, leaseUntil: null, nextAttemptAt: now }).where(eq(finalizations.id, op.id));
      return change;
    }),
    settleRevision: async (lease, applied, errorCode) => {
      const current = (await db.select().from(finalizations).where(eq(finalizations.id, lease.id)))[0]?.body;
      if (!current) return false;
      return executionTransaction(db, current.serviceId, async (tx, now) => {
        const op = (await tx.select().from(finalizations).where(and(eq(finalizations.id, lease.id), eq(finalizations.sequence, lease.sequence), eq(finalizations.leaseOwner, lease.owner), gt(finalizations.leaseUntil, now))).for('update'))[0]?.body;
        if (!op || op.view.revision !== lease.revision || op.view.phaseState !== 'revising' || !op.revisionRequestId) return false;
        const change = (await tx.select().from(finalizationRevisions).where(eq(finalizationRevisions.id, op.revisionRequestId)))[0]!.body;
        if (change.state !== 'pending') return false;
        const body: FinalizationOperation = applied ? { ...op, archive: change.input.archive, lease: null, evidence: { bindingConfirmed: true, volumeIdentityConfirmed: op.evidence.volumeIdentityConfirmed, completionProofDigest: op.evidence.completionProofDigest },
          view: { ...op.view, revision: op.view.revision + 1, phase: 'requested', phaseState: 'pending', computeStopped: false, errorCode: null, message: null, retryable: false, nextRetryAt: null, updatedAt: now.toISOString() } }
          : { ...op, lease: null, view: { ...op.view, phaseState: 'pending', errorCode: null, message: null, nextRetryAt: null, updatedAt: now.toISOString() } };
        await tx.update(finalizationRevisions).set({ body: { ...change, state: applied ? 'applied' : 'rejected', errorCode, updatedAt: now.toISOString() } }).where(eq(finalizationRevisions.id, change.id));
        await tx.update(finalizations).set({ body, phase: body.view.phase, leaseOwner: null, leaseUntil: null, nextAttemptAt: now }).where(eq(finalizations.id, op.id));
        return true;
      });
    },
  };
}
