import type { ProjectDeletionContext, ProjectDeletionStepResult, TaskVolumeTarget } from '@crewstation/contracts';
import { TaskVolumeTargetSchema } from '@crewstation/contracts';
import type { K8sClient } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { ClusterDeletionAdmission } from '../../../api/projectDeletion';
import type { ClusterVolumeReclamationStore, ProjectVolumeReclamation } from '../../../api/projectVolumeReclamation';
import type { LedgerObservations } from '../../../ports/ledger';
import { inspectProjectVolumes } from './volumeInspection';
import { inspectTaskVolume, removeTaskVolume, taskVolumeReclaimed } from '../safety/volumeReclaim';
import type { VolumeProbeOptions } from '../safety/volumeReclaim';

const expectedVolumes = (context: ProjectDeletionContext) => context.confirmed.resources.filter((entry) => entry.kind === 'protected:PVC');
function originalVolume(value: string): { uid: string; target?: TaskVolumeTarget } {
  const identity = JSON.parse(value); if (!identity.uid || typeof identity.uid !== 'string') throw precondition('原 PVC 身份不完整');
  return { uid: identity.uid, ...(identity.target ? { target: TaskVolumeTargetSchema.parse(identity.target) } : {}) };
}
const done = (context: ProjectDeletionContext, phase: string): ProjectDeletionStepResult => ({ kind: 'done', evidence: { kind: phase === 'seal' ? 'metadata' : 'physical', count: expectedVolumes(context).length,
  digest: jsonHash({ original: expectedVolumes(context), operationId: context.operationId, phase }), description: phase === 'seal' ? '原 PVC/PV 与供应器位置已固定；未绑定卷仍等待原供给收敛' : '原 PVC/PV 不存在，且原供应器的删除 finalizer／节点认证物理探针确认存储回收' } });
export function kubernetesProjectVolumeReclamation(k8s: K8sClient, ledger: Pick<LedgerObservations, 'claimOf' | 'get'>, admission: ClusterDeletionAdmission, store: ClusterVolumeReclamationStore, options: VolumeProbeOptions, now: () => Date, fetcher: typeof fetch = fetch): ProjectVolumeReclamation {
  const inspect: ProjectVolumeReclamation['inspect'] = (target) => inspectProjectVolumes(k8s, ledger, admission, store, target, options, now());
  const authorize = async (context: ProjectDeletionContext) => { if (context.confirmed.participant !== 'resources' || expectedVolumes(context).some((entry) => JSON.parse(entry.id).namespace !== context.target.namespace)) throw precondition('物理卷清理许可范围不符'); await admission.assertGrant(context); };
  const resolve = async (context: ProjectDeletionContext, key: string, identity: ReturnType<typeof originalVolume>) => {
    const saved = await store.get(context, key);
    if (saved) { if (saved.target.uid !== identity.uid || identity.target && jsonHash(saved.target) !== jsonHash(identity.target)) throw precondition('持久卷目标不是原确认实例'); return saved.target; }
    if (identity.target) { await store.pin(context, key, identity.target); return identity.target; }
    const reference = JSON.parse(key), pvc = await k8s.get(Resources.PersistentVolumeClaim!, reference.name, reference.namespace, AbortSignal.timeout(15_000));
    if (!pvc || pvc.metadata.uid !== identity.uid) throw precondition('未绑定原 PVC 消失或替换，不能补造存储回收证明');
    if (!(pvc['spec'] as { volumeName?: string })?.volumeName) return undefined;
    const target = await inspectTaskVolume(k8s, reference.namespace, reference.name, options, now());
    if (!target || target.uid !== identity.uid) throw precondition('原供给完成后的 PVC/PV 身份不符');
    await authorize(context); await store.pin(context, key, target); return target;
  };
  return { inspect,
    seal: async (context) => { if (context.phase !== 'seal') throw precondition('固定卷身份的许可阶段不符'); await authorize(context); for (const entry of expectedVolumes(context)) await resolve(context, entry.id, originalVolume(entry.identity)); return done(context, 'seal'); },
    purge: async (context) => {
      if (context.phase !== 'purge') throw precondition('物理卷销毁许可阶段不符'); await authorize(context);
      for (const entry of expectedVolumes(context)) {
        const target = await resolve(context, entry.id, originalVolume(entry.identity)); if (!target) return { kind: 'waiting', reason: '原 PVC 尚未绑定供应器，等待在途供给收敛；不会把空 PV 列表当成物理回收' };
        await authorize(context); await removeTaskVolume(k8s, target, options, now());
        if (!await taskVolumeReclaimed(k8s, target, options, now(), fetcher)) return { kind: 'waiting', reason: '等待原 PVC/PV、供应器和底层文件目录实际回收' };
        const previous = await store.get(context, entry.id); await store.reclaimed(context, entry.id, previous?.digest ?? jsonHash({ target, storageReclaimed: true }), previous?.observedAt ?? now().toISOString());
      }
      return done(context, 'purge');
    },
    prove: async (context) => verifyVolumes(context, 'prove', store, k8s, options, now, authorize, fetcher),
    verify: async (context) => verifyVolumes(context, 'verify', store, k8s, options, now, authorize, fetcher),
  };
}
async function verifyVolumes(context: ProjectDeletionContext, phase: 'prove' | 'verify', store: ClusterVolumeReclamationStore, k8s: K8sClient, options: VolumeProbeOptions, now: () => Date, authorize: (context: ProjectDeletionContext) => Promise<void>, fetcher: typeof fetch): Promise<ProjectDeletionStepResult> {
  if (context.phase !== phase) throw precondition('物理卷复核许可阶段不符'); await authorize(context);
  for (const entry of expectedVolumes(context)) {
    const original = originalVolume(entry.identity), row = await store.get(context, entry.id);
    if (!row?.digest || row.target.uid !== original.uid || original.target && jsonHash(original.target) !== jsonHash(row.target)) return { kind: 'waiting', reason: '尚未确认原卷供应器身份及物理回收回执' };
    if (!await taskVolumeReclaimed(k8s, row.target, options, now(), fetcher)) return { kind: 'waiting', reason: '原卷或底层存储复核仍有残留' };
  }
  return done(context, phase);
}
