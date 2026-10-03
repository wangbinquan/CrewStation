import { and, asc, eq, gt, lte, ne, or, isNull, inArray, sql } from 'drizzle-orm';
import { validation } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { FinalizationOperations } from '../../../ports/storage/finalizations';
import { advanceFinalization } from '../../../domain/finalization/operation';
import { executionNow, executionTransaction } from '../executionTransaction';
import { finalizationRevisionOperations } from './revisions';
import { finalizations } from './tables';
import { acceptFinalization, recordFinalizationTaskState } from './intake';
import { bindFinalizationVolume } from './volume';
import { businessAdmissionOpen } from '../deletion/admission';

export function finalizationOperations(db: Database): FinalizationOperations {
  return {
    accept: acceptFinalization(db),
    bindVolume: bindFinalizationVolume(db),
    ...finalizationRevisionOperations(db),
    get: async (id) => (await db.select().from(finalizations).where(eq(finalizations.id, id)))[0]?.body,
    forTask: async (serviceId, taskId) => (await db.select().from(finalizations).where(and(eq(finalizations.serviceId, serviceId), eq(finalizations.taskId, taskId))))[0]?.body,
    claim: (input) => db.transaction(async (tx) => {
      if (!input.owner || !Number.isSafeInteger(input.leaseSeconds) || input.leaseSeconds < 1 || input.leaseSeconds > 300) throw validation('终结作业租约无效');
      const now = await executionNow(tx);
      const row = (await tx.select().from(finalizations).where(and(businessAdmissionOpen(finalizations.serviceId), ne(finalizations.phase, 'completed'), sql`(${finalizations.body}->'view'->>'phaseState' = 'revising') = ${input.revising ?? false}`, lte(finalizations.nextAttemptAt, now), or(isNull(finalizations.leaseUntil), lte(finalizations.leaseUntil, now)), input.id ? eq(finalizations.id, input.id) : undefined, input.phases ? inArray(finalizations.phase, [...input.phases]) : undefined))
        .orderBy(asc(finalizations.nextAttemptAt), asc(finalizations.id)).limit(1).for('update', { skipLocked: true }))[0];
      if (!row) return undefined;
      const until = new Date(now.getTime() + input.leaseSeconds * 1000), sequence = row.sequence + 1;
      const body = { ...row.body, sequence, lease: { owner: input.owner, until: until.toISOString() } };
      await tx.update(finalizations).set({ body, sequence, leaseOwner: input.owner, leaseUntil: until }).where(eq(finalizations.id, row.id));
      return body;
    }),
    progress: async (lease, input) => {
      const current = (await db.select({ serviceId: finalizations.serviceId }).from(finalizations).where(eq(finalizations.id, lease.id)))[0];
      if (!current) return false;
      return executionTransaction(db, current.serviceId, async (tx, now) => {
        const row = (await tx.select().from(finalizations).where(and(eq(finalizations.id, lease.id), eq(finalizations.sequence, lease.sequence), eq(finalizations.leaseOwner, lease.owner), gt(finalizations.leaseUntil, now))).for('update'))[0];
        if (!row || row.body.view.revision !== lease.revision || row.phase === 'completed') return false;
        const body = advanceFinalization(row.body, input, now), requested = body.view.nextRetryAt ? Date.parse(body.view.nextRetryAt) : now.getTime();
        if (!Number.isFinite(requested)) throw validation('终结重试时间无效');
        // Blocked work remains durable and fair; never hot-loop a missing stop proof.
        const nextAttemptAt = new Date(Math.max(requested, now.getTime() + (['blocked', 'retrying'].includes(input.phaseState) ? 5000 : 0)));
        await tx.update(finalizations).set({ body, phase: body.view.phase, leaseOwner: null, leaseUntil: null, nextAttemptAt }).where(eq(finalizations.id, row.id));
        if (body.view.phase === 'completed') await recordFinalizationTaskState(tx, body, now);
        return true;
      });
    },
  };
}
