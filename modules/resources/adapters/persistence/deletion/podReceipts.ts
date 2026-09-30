import type { ProjectDeletionContext } from '@crewstation/contracts';
import { ProjectDeletionDigestSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { ProjectPodStopReceipt, ProjectPodStopReceipts } from '../../../api/deletionPods';
import { assertResourceDeletionFence } from './repository';

async function get(db: Executor, context: ProjectDeletionContext, key: string, uid: string): Promise<ProjectPodStopReceipt | undefined> {
  const rows = await db.execute<{ original_uid: string; node_uid: string | null; proof_digest: string; observed_at: string | Date }>(sql`SELECT original_uid,node_uid,proof_digest,observed_at FROM resources.deletion_stop_receipts WHERE project_id = ${context.target.id} AND operation_id = ${context.operationId} AND object_key = ${key}`);
  const row = rows[0];
  if (row && row.original_uid !== uid) throw precondition('停止回执不能用于同名替换实例');
  return row ? { key, uid, nodeUid: row.node_uid, digest: row.proof_digest, observedAt: new Date(row.observed_at).toISOString() } : undefined;
}
export function projectPodStopReceipts(db: Database, assertGrant: (context: ProjectDeletionContext) => Promise<void>): ProjectPodStopReceipts {
  const authorized = async (context: ProjectDeletionContext, tx: Executor) => { await assertGrant(context); await assertResourceDeletionFence(tx, context, 'resources'); };
  return {
    get: (context, key, uid) => db.transaction(async (tx) => { await authorized(context, tx); return get(tx, context, key, uid); }),
    save: (context, receipt) => db.transaction(async (tx) => {
      if (context.phase !== 'stop' || context.confirmed.participant !== 'resources') throw precondition('Pod 停止回执阶段或来源不符');
      ProjectDeletionDigestSchema.parse(receipt.digest);
      if (!Number.isFinite(Date.parse(receipt.observedAt))) throw precondition('停止观测时间不完整');
      const original = context.confirmed.resources.find((entry) => entry.kind === 'protected:Pod' && entry.id === receipt.key);
      const identity = original ? JSON.parse(original.identity) : undefined;
      if (!original || identity.uid !== receipt.uid || identity.nodeUid !== receipt.nodeUid) throw precondition('停止实例或原节点不属于原确认范围');
      await authorized(context, tx);
      const previous = await get(tx, context, receipt.key, receipt.uid);
      if (previous) { if (jsonHash(previous) !== jsonHash(receipt)) throw precondition('不可替换已经确认的原停止证明'); return; }
      await tx.execute(sql`SELECT set_config('crewstation.resources_stop_proof', ${context.operationId}, true)`);
      await tx.execute(sql`INSERT INTO resources.deletion_stop_receipts(project_id,operation_id,object_key,original_uid,node_uid,proof_digest,observed_at) VALUES (${context.target.id},${context.operationId},${receipt.key},${receipt.uid},${receipt.nodeUid},${receipt.digest},${receipt.observedAt})`);
    }),
  };
}
