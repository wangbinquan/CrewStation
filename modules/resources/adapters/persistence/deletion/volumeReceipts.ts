import type { ProjectDeletionContext, ProjectId, TaskVolumeTarget } from '@crewstation/contracts';
import { ProjectDeletionDigestSchema, TaskVolumeTargetSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { ProjectVolumeReclaimReceipt, ProjectVolumeReclamationStore } from '../../../api/deletionVolumes';
import { assertResourceDeletionFence } from './repository';

async function known(db: Executor, id: ProjectId): Promise<TaskVolumeTarget[]> {
  const rows = await db.execute<{ target: unknown }>(sql`SELECT body->'target' AS target FROM resources.task_volume_safety WHERE resource_id IN (SELECT id FROM resources.records WHERE project_id = ${id}) AND body->'target' IS NOT NULL AND body->'target' <> 'null'::jsonb`);
  return rows.map((row) => TaskVolumeTargetSchema.parse(row.target));
}
async function get(db: Executor, context: ProjectDeletionContext, key: string): Promise<ProjectVolumeReclaimReceipt | undefined> {
  const rows = await db.execute<{ original_target: unknown; proof_digest: string | null; observed_at: string | Date | null }>(sql`SELECT original_target,proof_digest,observed_at FROM resources.deletion_volume_receipts WHERE project_id = ${context.target.id} AND operation_id = ${context.operationId} AND object_key = ${key}`);
  const row = rows[0]; return row ? { key, target: TaskVolumeTargetSchema.parse(row.original_target), digest: row.proof_digest, observedAt: row.observed_at ? new Date(row.observed_at).toISOString() : null } : undefined;
}
export function projectVolumeReclamationStore(db: Database, assertGrant: (context: ProjectDeletionContext) => Promise<void>): ProjectVolumeReclamationStore {
  const authorized = async (context: ProjectDeletionContext, tx: Executor) => { if (context.confirmed.participant !== 'resources') throw precondition('卷回收许可来源不符'); await assertGrant(context); await assertResourceDeletionFence(tx, context, 'resources'); };
  return { known: (id) => known(db, id),
    get: (context, key) => db.transaction(async (tx) => { await authorized(context, tx); return get(tx, context, key); }),
    pin: (context, key, input) => db.transaction(async (tx) => {
      if (!['seal', 'purge'].includes(context.phase)) throw precondition('原卷身份固定阶段不符');
      const target = TaskVolumeTargetSchema.parse(input), original = context.confirmed.resources.find((entry) => entry.kind === 'protected:PVC' && entry.id === key);
      const identity = original ? JSON.parse(original.identity) as { uid: string; target?: TaskVolumeTarget } : undefined;
      const originalKey = original ? JSON.parse(original.id) : undefined;
      if (!identity || identity.uid !== target.uid || target.namespace !== context.target.namespace || originalKey.name !== target.name || originalKey.namespace !== target.namespace || identity.target && jsonHash(identity.target) !== jsonHash(target)) throw precondition('供应器目标不属于原确认 PVC/PV');
      await authorized(context, tx); const previous = await get(tx, context, key);
      if (previous) { if (jsonHash(previous.target) !== jsonHash(target)) throw precondition('原 PV 或供应器位置不能替换'); return; }
      await tx.execute(sql`SELECT set_config('crewstation.resources_volume_reclaim', ${context.operationId}, true)`);
      await tx.execute(sql`INSERT INTO resources.deletion_volume_receipts(project_id,operation_id,object_key,pvc_uid,pv_uid,original_target) VALUES (${context.target.id},${context.operationId},${key},${target.uid},${target.pvUid},${JSON.stringify(target)}::jsonb)`);
    }),
    reclaimed: (context, key, digest, observedAt) => db.transaction(async (tx) => {
      if (!['purge', 'prove'].includes(context.phase)) throw precondition('卷物理回收证明阶段不符');
      ProjectDeletionDigestSchema.parse(digest); if (!Number.isFinite(Date.parse(observedAt))) throw precondition('卷回收观测时间不完整');
      await authorized(context, tx); const row = await get(tx, context, key); if (!row) throw precondition('尚未固定原卷供应器身份');
      if (row.digest) { if (row.digest !== digest) throw precondition('原物理回收证明不可替换'); return; }
      await tx.execute(sql`SELECT set_config('crewstation.resources_volume_reclaim', ${context.operationId}, true)`);
      await tx.execute(sql`UPDATE resources.deletion_volume_receipts SET proof_digest = ${digest},observed_at = ${observedAt} WHERE project_id = ${context.target.id} AND operation_id = ${context.operationId} AND object_key = ${key}`);
    }),
  };
}
