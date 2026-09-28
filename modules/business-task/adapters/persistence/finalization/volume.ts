import { and, eq, gt } from 'drizzle-orm';
import { AcceptedArchiveFinalizationSchema } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { FinalizationOperations } from '../../../ports/storage/finalizations';
import { executionTransaction } from '../executionTransaction';
import { finalizations } from './tables';

/** Only the runtime observer may resolve an initially unknown UID, before any archive binding exists. */
export function bindFinalizationVolume(db: Database): FinalizationOperations['bindVolume'] {
  return async (lease, uid) => {
    AcceptedArchiveFinalizationSchema.shape.volumeUid.parse(uid);
    const current = (await db.select({ serviceId: finalizations.serviceId }).from(finalizations).where(eq(finalizations.id, lease.id)))[0];
    if (!current) return undefined;
    return executionTransaction(db, current.serviceId, async (tx, now) => {
      const row = (await tx.select().from(finalizations).where(and(eq(finalizations.id, lease.id), eq(finalizations.sequence, lease.sequence), eq(finalizations.leaseOwner, lease.owner), gt(finalizations.leaseUntil, now))).for('update'))[0];
      if (!row || row.body.view.revision !== lease.revision) return undefined;
      const op = row.body;
      if (op.view.phase !== 'requested' || op.volumeUid !== uid && (op.volumeUid !== null || op.evidence.volumeIdentityConfirmed || op.evidence.bindingConfirmed)) throw conflict('已确认或归档绑定后的工作卷身份不可替换');
      const body = { ...op, volumeUid: uid, evidence: { ...op.evidence, volumeIdentityConfirmed: true as const } };
      await tx.update(finalizations).set({ body }).where(eq(finalizations.id, op.id));
      return body;
    });
  };
}
