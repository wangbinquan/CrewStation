import { and, eq } from 'drizzle-orm';
import { text } from 'drizzle-orm/pg-core';
import { TaskVolumeClaimSchema, TaskVolumeDeletionPermitSchema, TaskVolumeTargetSchema, TaskVolumeReclaimProofSchema, TaskIdSchema } from '@crewstation/contracts';
import type { TaskVolumeSafetyState } from '@crewstation/contracts';
import { conflict, jsonHash, notFound, precondition } from '@crewstation/kernel';
import { jsonDocument } from '@crewstation/persistence';
import type { Database, Executor } from '@crewstation/persistence';
import type { TaskVolumes } from '../../../api/taskVolumes';
import type { LedgerRecord } from '../../../domain/record';
import { mergeConditions } from '../../../domain/conditions';
import { protectedTaskVolume } from '../../../domain/taskStorage';
import { drizzleRecordRepository } from '../drizzleRecords';
import { resourcesSchema } from '../schema';
import { lockStorageTask } from './guards';
import { storageFences, stopScans } from './tables';

const volumes = resourcesSchema.table('task_volume_safety', { resourceId: text('resource_id').primaryKey(), body: jsonDocument('body').$type<TaskVolumeSafetyState>().notNull() });
const saved = async (tx: Executor, id: string) => (await tx.select().from(volumes).where(eq(volumes.resourceId, id)))[0]?.body;
const save = async (tx: Executor, row: TaskVolumeSafetyState) => { await tx.insert(volumes).values({ resourceId: row.resourceId, body: row }).onConflictDoUpdate({ target: volumes.resourceId, set: { body: row } }); };
async function owned(tx: Executor, id: string) {
  const record = await drizzleRecordRepository(tx).get(id);
  if (!record || !protectedTaskVolume(record) || record.owner.module !== 'task-runtime' || !record.parentId) throw notFound('归档任务卷');
  return record;
}
async function state(tx: Executor, id: string): Promise<TaskVolumeSafetyState> {
  const record = await owned(tx, id);
  return await saved(tx, id) ?? { resourceId: id, taskId: record.parentId!, provisionIssued: false, target: null, permit: null, proof: null };
}
export function taskVolumeRepository(db: Database, publish: (tx: Executor, previous: LedgerRecord, draft: LedgerRecord, now: Date) => Promise<unknown>): TaskVolumes {
  const change = <T>(id: string, run: (tx: Executor, row: TaskVolumeSafetyState) => Promise<T>) => db.transaction(async (tx) => {
    const first = await owned(tx, id); await lockStorageTask(tx, first.parentId!);
    await drizzleRecordRepository(tx).get(id, { forUpdate: true }); return run(tx, await state(tx, id));
  });
  return {
    forTask: async (taskId) => { const record = await drizzleRecordRepository(db).getByOwner({ module: 'task-runtime', ref: `${taskId}/work` }, 'volume'); if (!record) throw notFound('归档任务卷'); return state(db, record.id); },
    get: (id) => state(db, id),
    recordClaim: (id, input) => change(id, async (tx, row) => {
      const claim = TaskVolumeClaimSchema.parse(input), record = await owned(tx, id);
      if (!record.spec.children.some((c) => c.kind === 'PersistentVolumeClaim' && c.namespace === claim.namespace && c.name === claim.name)) throw conflict('PVC 不属于原任务声明');
      if (row.claim && jsonHash(row.claim) !== jsonHash(claim) || row.target && row.target.uid !== claim.uid) throw conflict('原工作卷已经替换', { code: 'workspace_volume_changed' });
      if (!row.provisionIssued || row.permit) throw precondition('PVC 没有有效供给意图');
      if (!row.claim) await save(tx, { ...row, claim });
    }),
    beginProvision: (id) => change(id, async (tx, row) => {
      const fence = (await tx.select().from(storageFences).where(eq(storageFences.taskId, row.taskId)))[0];
      const record = await owned(tx, id);
      if (row.permit || fence?.finalization || record.desired !== 'present' || record.spec['neverProvisioned'] === true) throw precondition('任务卷供给已冻结', { code: 'task_finalizing' });
      // This intent never expires. An ambiguous create cannot later be called never-provisioned.
      if (!row.provisionIssued) await save(tx, { ...row, provisionIssued: true });
    }),
    recordTarget: (id, input) => change(id, async (tx, row) => {
      const target = TaskVolumeTargetSchema.parse(input), record = await owned(tx, id);
      if (row.claim && row.claim.uid !== target.uid) throw conflict('PV 未绑定原 PVC', { code: 'workspace_volume_changed' });
      if (!record.spec.children.some((c) => c.kind === 'PersistentVolumeClaim' && c.namespace === target.namespace && c.name === target.name)) throw conflict('物理卷不属于原任务声明');
      if (row.target) { if (jsonHash(row.target) !== jsonHash(target)) throw conflict('原工作卷或供应器身份已变化', { code: 'workspace_volume_changed' }); return; }
      if (row.permit || !row.provisionIssued) throw precondition('工作卷没有已记录的供给意图');
      await save(tx, { ...row, target });
    }),
    permitDeletion: (id, input) => change(id, async (tx, row) => {
      const permit = TaskVolumeDeletionPermitSchema.parse(input), record = await owned(tx, id);
      if (permit.taskId !== TaskIdSchema.parse(row.taskId)) throw conflict('删除许可不属于此任务');
      if (row.permit) { if (jsonHash(row.permit) !== jsonHash(permit)) throw conflict('原工作卷已有不同的删除许可'); return; }
      const fence = (await tx.select().from(storageFences).where(eq(storageFences.taskId, row.taskId)))[0];
      const scan = (await tx.select().from(stopScans).where(and(eq(stopScans.taskId, row.taskId), eq(stopScans.revision, permit.revision), eq(stopScans.scope, 'all'))))[0]?.body;
      if (!fence?.sealed || fence.finalization?.operationId !== permit.operationId || fence.finalization.revision !== permit.revision || !scan?.complete || scan.operationId !== permit.operationId || scan.digest !== permit.allConsumersStoppedDigest) throw precondition('全部卷消费者停止屏障尚未完成');
      if (permit.volumeUid === null ? row.provisionIssued || row.target !== null || record.children.some((c) => c.kind === 'PersistentVolumeClaim' && c.uid) : row.target?.uid !== permit.volumeUid) throw precondition('原工作卷回收证据不完整', { code: 'volume_reclaim_unavailable' });
      await save(tx, { ...row, permit });
      const now = new Date();
      await publish(tx, record, { ...record, desired: 'absent', generation: record.generation + 1,
        spec: { ...record.spec, finalizationPermit: permit }, releaseReason: { code: 'task-finalization', message: '产物已归档，正在回收原任务工作卷' },
        conditions: mergeConditions(record.conditions, [{ type: 'Provisioning', status: 'false' }], now) }, now);
    }),
    recordReclaimed: (id, proof) => change(id, async (tx, row) => {
      TaskVolumeReclaimProofSchema.parse(proof);
      if (row.proof) { if (row.proof.permitId !== proof.permitId) throw conflict('回收证明不可替换'); return; }
      const permit = row.permit;
      if (!permit || proof.permitId !== permit.id || proof.volumeUid !== permit.volumeUid || proof.pvUid !== (row.target?.pvUid ?? null)) throw conflict('回收证明与原卷删除许可不符');
      const never = !row.provisionIssued && !row.target && permit.volumeUid === null;
      if (never ? proof.disposition !== 'never-provisioned' || proof.source !== 'never-provisioned' || proof.storageReclaimed !== null : proof.disposition !== 'deleted' || proof.storageReclaimed !== true || proof.source !== (row.target?.kind === 'csi' ? 'csi-provisioner' : 'local-path-probe')) throw precondition('供应器回收证据不完整');
      await save(tx, { ...row, proof });
      const record = await owned(tx, id), now = new Date();
      await publish(tx, record, { ...record, conditions: mergeConditions(record.conditions, [{ type: 'StorageReclaimed', status: 'true', reason: proof.id, message: never ? '从未申请工作卷，供给准入已永久关闭' : '原工作卷及底层存储已确认回收' }], now) }, now);
    }),
  };
}
