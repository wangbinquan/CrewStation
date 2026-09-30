import type { ProjectDeletionInventory, ProjectDeletionTarget, TaskVolumeTarget } from '@crewstation/contracts';
import type { K8sClient } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { ClusterDeletionAdmission } from '../../../api/projectDeletion';
import type { ClusterVolumeReclamationStore } from '../../../api/projectVolumeReclamation';
import type { LedgerObservations } from '../../../ports/ledger';
import { originalUid } from '../../../domain/deletion/objects';
import { inspectProjectCluster } from './inspection';
import { inspectTaskVolume } from '../safety/volumeReclaim';
import type { VolumeProbeOptions } from '../safety/volumeReclaim';

export const volumeKey = (target: Pick<TaskVolumeTarget, 'name' | 'namespace'>) => JSON.stringify({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', namespace: target.namespace, name: target.name });
export async function inspectProjectVolumes(k8s: K8sClient, ledger: Pick<LedgerObservations, 'claimOf' | 'get'>, admission: ClusterDeletionAdmission, store: ClusterVolumeReclamationStore, target: ProjectDeletionTarget, options: VolumeProbeOptions, now: Date): Promise<ProjectDeletionInventory> {
  const report = await inspectProjectCluster(k8s, ledger, admission, target, options.systemNamespace), known = await store.known(target.id);
  const resources: ProjectDeletionInventory['resources'] = [];
  for (const record of report.resources.filter((entry) => entry.kind === 'PersistentVolumeClaim')) {
    const key = JSON.parse(record.id) as { namespace: string; name: string }, uid = originalUid(record);
    const pvc = await k8s.get(Resources.PersistentVolumeClaim!, key.name, key.namespace, AbortSignal.timeout(15_000));
    if (!pvc || pvc.metadata.uid !== uid) throw precondition('原 PVC 在盘点期间消失或替换');
    let supplier = known.find((entry) => entry.namespace === key.namespace && entry.name === key.name);
    if (supplier && (supplier.uid !== uid || (pvc['spec'] as { volumeName?: string } | undefined)?.volumeName !== supplier.pvName)) throw precondition('已知原卷的 PVC/PV 实例被替换');
    if (!supplier && (pvc['spec'] as { volumeName?: string } | undefined)?.volumeName) supplier = await inspectTaskVolume(k8s, key.namespace, key.name, options, now);
    resources.push({ kind: 'protected:PVC', id: record.id, identity: JSON.stringify({ uid, ...(supplier ? { target: supplier } : {}) }), count: 1 });
  }
  // 原 PVC 已消失仍须对原 PV 和底层目录复核，不能把空命名空间当成存储已回收。
  for (const supplier of known) {
    if (supplier.namespace !== target.namespace) throw precondition('项目卷供应器位置跨命名空间，停止清理');
    const key = volumeKey(supplier), previous = resources.find((entry) => entry.id === key);
    if (!previous) resources.push({ kind: 'protected:PVC', id: key, identity: JSON.stringify({ uid: supplier.uid, target: supplier }), count: 1 });
    else if (jsonHash(JSON.parse(previous.identity).target) !== jsonHash(supplier)) throw precondition('同一原 PVC 的供应器来源存在冲突');
  }
  resources.sort((a, b) => a.id.localeCompare(b.id));
  return { participant: 'resources', resources, revision: jsonHash(resources), complete: report.complete, references: report.references, blockers: report.blockers };
}
