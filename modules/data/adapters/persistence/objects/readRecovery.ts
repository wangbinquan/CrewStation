import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ObjectDigestSchema } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { objectStorageTransaction, requireObjectBackend, requireObjectSpace } from '../objectCatalog';
import { objectReadTransfers } from '../objectTables';
import { changeTransferCount } from '../objectUploads';

export async function recoverStoppedReads(db: Database, podUid: string, proofDigest: string): Promise<void> {
  z.uuid().parse(podUid); ObjectDigestSchema.parse(proofDigest);
  await objectStorageTransaction(db, async (tx, now) => {
    await tx.execute(sql`INSERT INTO data.object_transfer_stops (pod_uid,proof_digest,observed_at) VALUES (${podUid},${proofDigest},${now.toISOString()}::timestamptz) ON CONFLICT DO NOTHING`);
    const rows = await tx.select().from(objectReadTransfers).where(and(sql`split_part(${objectReadTransfers.body}->>'owner',':',1)=${podUid}`, sql`${objectReadTransfers.body}->>'endedAt' IS NULL`)).limit(100);
    for (const { body: transfer } of rows) {
      await tx.update(objectReadTransfers).set({ body: { ...transfer, endedAt: now.toISOString() } }).where(eq(objectReadTransfers.id, transfer.id));
      await changeTransferCount(tx, await requireObjectBackend(tx, transfer.backendId), await requireObjectSpace(tx, transfer.spaceId), -1);
    }
    // The global transfer cap is 64, so one stopped process cannot exceed this bounded page.
    if (rows.length === 100) throw conflict('停止进程的读记录超出预期，保留原 Pod 证明等待检查');
  });
}
