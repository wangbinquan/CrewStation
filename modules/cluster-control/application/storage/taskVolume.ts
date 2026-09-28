import { newResourceId, precondition } from '@crewstation/kernel';
import type { Clock } from '@crewstation/kernel';
import type { ClusterWriter } from '../../ports/cluster';
import type { LedgerObservations, LedgerRecordView } from '../../ports/ledger';

/** The normal child cascade never deletes these PVCs. Only a durable original-UID permit reaches this path. */
export async function reconcileTaskVolume(deps: { ledger: LedgerObservations; cluster: ClusterWriter; clock: Clock; signal?: AbortSignal }, record: LedgerRecordView, enqueue: (id: string, delay?: number) => void): Promise<void> {
  if (record.kind !== 'volume' || !record.spec['taskStorage']) return;
  const port = deps.ledger.taskVolumes, cluster = deps.cluster;
  try {
    if (!port || !cluster.inspectTaskVolume || !cluster.taskVolumeReclaimed || !cluster.removeTaskVolume) throw precondition('任务卷回收观测尚不可用');
    const state = await port.get(record.id), child = record.spec.children.find((c) => c.kind === 'PersistentVolumeClaim');
    if (record.desired === 'present') {
      if (!child?.namespace) { if (record.spec['neverProvisioned'] === true && !state.provisionIssued && !state.target) return; throw precondition('任务卷声明不完整'); }
      if (cluster.inspectTaskClaim) {
        const claim = await cluster.inspectTaskClaim(child.namespace, child.name);
        if (claim) { if (!port.recordClaim) throw precondition('原 PVC 身份持久化不可用'); await port.recordClaim(record.id, claim); }
      }
      const target = await cluster.inspectTaskVolume(child.namespace, child.name, deps.clock.now());
      if (target) {
        await port.recordTarget(record.id, target);
        await deps.ledger.observeConditions(record.id, [{ type: 'CleanupBlocked', status: 'false' }]);
      }
      return;
    }
    if (state.proof) { await deps.ledger.observeConditions(record.id, [{ type: 'CleanupBlocked', status: 'false' }]); return; }
    if (!state.permit) throw precondition('原任务卷尚无持久删除许可');
    const target = state.target;
    if (!target) {
      if (state.provisionIssued || state.permit.volumeUid !== null) throw precondition('已发出工作卷供给请求，不能断言从未建卷');
      await port.recordReclaimed(record.id, { id: newResourceId(), permitId: state.permit.id, volumeUid: null, pvUid: null, disposition: 'never-provisioned', storageReclaimed: null, source: 'never-provisioned', observedAt: deps.clock.now().toISOString() });
      return;
    }
    if (target.uid !== state.permit.volumeUid || child?.namespace !== target.namespace || child.name !== target.name) throw precondition('删除许可与原任务卷不符');
    deps.signal?.throwIfAborted();
    await cluster.removeTaskVolume(target, deps.clock.now());
    if (!await cluster.taskVolumeReclaimed(target, deps.clock.now())) { enqueue(record.id, 5000); return; }
    await port.recordReclaimed(record.id, { id: newResourceId(), permitId: state.permit.id, volumeUid: target.uid, pvUid: target.pvUid, disposition: 'deleted', storageReclaimed: true,
      source: target.kind === 'csi' ? 'csi-provisioner' : 'local-path-probe', observedAt: deps.clock.now().toISOString() });
    await deps.ledger.observeConditions(record.id, [{ type: 'CleanupBlocked', status: 'false' }]);
  } catch (error) {
    await deps.ledger.observeConditions(record.id, [{ type: 'CleanupBlocked', status: 'true', reason: 'storage-proof-pending', message: error instanceof Error ? error.message.slice(0, 500) : '存储回收观测暂不可用' }]);
    enqueue(record.id, 10_000);
  }
}
