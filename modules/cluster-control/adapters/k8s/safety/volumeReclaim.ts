import { isIP } from 'node:net';
import { basename, dirname } from 'node:path';
import type { TaskVolumeTarget } from '@crewstation/contracts';
import { AbsenceResponseSchema } from '@crewstation/filesystem-metrics';
import { boundedMetricsText, Resources } from '@crewstation/k8s';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import { nodeEvidence } from './workloadStop';

export interface VolumeProbeOptions { systemNamespace: string; probeToken: string; probeRoot: string; probePort: number }
interface PvcSpec { volumeName?: string; storageClassName?: string }
interface PvSpec { claimRef?: { uid?: string; name?: string; namespace?: string }; persistentVolumeReclaimPolicy?: string; csi?: { driver?: string; volumeHandle?: string }; hostPath?: { path?: string }; local?: { path?: string } }
interface PodSpec { nodeName?: string; volumes?: Array<{ name: string; hostPath?: { path: string; type?: string } }>; containers?: Array<{ volumeMounts?: Array<{ name: string; mountPath: string; readOnly?: boolean }> }> }
interface PodStatus { podIP?: string; conditions?: Array<{ type: string; status: string }> }
const finalizer = 'external-provisioner.volume.kubernetes.io/finalizer';

export async function inspectTaskClaim(k8s: K8sClient, namespace: string, name: string) {
  const pvc = await k8s.get(Resources.PersistentVolumeClaim!, name, namespace, AbortSignal.timeout(15_000));
  if (!pvc) return undefined;
  if (!pvc.metadata.uid || pvc.metadata.deletionTimestamp) throw precondition('原 PVC 身份不可确认或正在删除', { code: 'volume_reclaim_unavailable' });
  return { namespace, name, uid: pvc.metadata.uid };
}

/** Pin the actual PVC/PV and provider before sending a delete request, never by name after disappearance. */
export async function inspectTaskVolume(k8s: K8sClient, namespace: string, name: string, options: VolumeProbeOptions, now: Date): Promise<TaskVolumeTarget | undefined> {
  const signal = AbortSignal.timeout(15_000), pvc = await k8s.get(Resources.PersistentVolumeClaim!, name, namespace, signal);
  if (!pvc) return undefined;
  const pvcSpec = pvc['spec'] as PvcSpec | undefined;
  if (!pvc.metadata.uid || pvc.metadata.deletionTimestamp || !pvcSpec?.volumeName) throw precondition('原工作卷尚未绑定或正在删除', { code: 'volume_reclaim_unavailable' });
  const pv = await k8s.get(Resources.PersistentVolume!, pvcSpec.volumeName, undefined, signal), spec = pv?.['spec'] as PvSpec | undefined;
  if (!pv?.metadata.uid || pv.metadata.deletionTimestamp || spec?.claimRef?.uid !== pvc.metadata.uid || spec.claimRef.name !== name || spec.claimRef.namespace !== namespace || spec.persistentVolumeReclaimPolicy !== 'Delete') throw precondition('原工作卷供应器或 Delete 回收策略尚未确认', { code: 'volume_reclaim_unavailable' });
  const base = { namespace, name, uid: pvc.metadata.uid, pvName: pv.metadata.name, pvUid: pv.metadata.uid };
  if (spec.csi?.driver && spec.csi.volumeHandle && pv.metadata.finalizers?.includes(finalizer)) return { ...base, kind: 'csi', driver: spec.csi.driver, handleDigest: jsonHash(spec.csi.volumeHandle), deletionFinalizer: finalizer };
  const path = spec.hostPath?.path ?? spec.local?.path, nodeName = pv.metadata.annotations?.['local.path.provisioner/selected-node'];
  if (pv.metadata.annotations?.['pv.kubernetes.io/provisioned-by'] !== 'rancher.io/local-path' || !path || !options.probeRoot || dirname(path) !== options.probeRoot || !nodeName || !options.probeToken) throw precondition('存储供应器没有可用的物理回收观测', { code: 'volume_reclaim_unavailable' });
  const node = await nodeEvidence(k8s, nodeName, now, signal);
  if (!node?.ready || !node.leaseFresh) throw precondition('工作卷所在节点尚未确认可观测', { code: 'volume_reclaim_unavailable' });
  await probeOnNode(k8s, options, nodeName, signal);
  return { ...base, kind: 'local-path', nodeName, nodeUid: node.uid, root: options.probeRoot, directory: basename(path) };
}
async function probeOnNode(k8s: K8sClient, options: VolumeProbeOptions, nodeName: string, signal: AbortSignal): Promise<K8sObject> {
  const pods = await k8s.list(Resources.Pod!, options.systemNamespace, { labelSelector: 'app=cs-storage-probe', signal });
  const valid = pods.filter((pod) => {
    const spec = pod['spec'] as PodSpec | undefined, status = pod['status'] as PodStatus | undefined;
    const volume = spec?.volumes?.find((v) => v.hostPath?.path === options.probeRoot && v.hostPath.type === 'Directory');
    return pod.metadata.uid && !pod.metadata.deletionTimestamp && spec?.nodeName === nodeName && status?.podIP && isIP(status.podIP) && status.conditions?.some((c) => c.type === 'Ready' && c.status === 'True')
      && volume && spec.containers?.some((c) => c.volumeMounts?.some((m) => m.name === volume.name && m.mountPath === '/volumes' && m.readOnly));
  });
  if (valid.length !== 1) throw precondition('原节点的只读存储探针尚未就绪', { code: 'volume_reclaim_unavailable' });
  return valid[0]!;
}
export async function removeTaskVolume(k8s: K8sClient, target: TaskVolumeTarget, options: VolumeProbeOptions, now: Date): Promise<void> {
  const pvc = await k8s.get(Resources.PersistentVolumeClaim!, target.name, target.namespace, AbortSignal.timeout(15_000));
  if (!pvc) return;
  if (pvc.metadata.uid !== target.uid) throw conflict('原工作卷已经替换', { code: 'workspace_volume_changed' });
  if (pvc.metadata.deletionTimestamp) return;
  const current = await inspectTaskVolume(k8s, target.namespace, target.name, options, now);
  if (jsonHash(current ?? null) !== jsonHash(target)) throw conflict('原存储供应器身份或回收保证已变化');
  await k8s.delete(Resources.PersistentVolumeClaim!, target.name, target.namespace, { preconditions: { uid: target.uid } });
}
/** PVC/PV absence is necessary; CSI finalizer or the original node's authenticated physical probe is the extra proof. */
export async function taskVolumeReclaimed(k8s: K8sClient, target: TaskVolumeTarget, options: VolumeProbeOptions, now: Date, fetcher: typeof fetch = fetch): Promise<boolean> {
  const signal = AbortSignal.timeout(15_000);
  const [pvc, pv] = await Promise.all([k8s.get(Resources.PersistentVolumeClaim!, target.name, target.namespace, signal), k8s.get(Resources.PersistentVolume!, target.pvName, undefined, signal)]);
  if (pvc && pvc.metadata.uid !== target.uid || pv && pv.metadata.uid !== target.pvUid) throw conflict('原卷名称已被替代资源占用', { code: 'workspace_volume_changed' });
  if (pvc || pv) return false;
  if (target.kind === 'csi') return true;
  if (target.root !== options.probeRoot) throw precondition('存储探针根目录已变化');
  const node = await nodeEvidence(k8s, target.nodeName, now, signal);
  if (!node?.ready || !node.leaseFresh || node.uid !== target.nodeUid) throw precondition('原节点身份或存储观测不可用', { code: 'volume_reclaim_unavailable' });
  const pod = await probeOnNode(k8s, options, target.nodeName, signal), address = (pod['status'] as PodStatus).podIP!;
  const key = `${target.uid}/${target.pvUid}`, started = Date.now();
  const response = await fetcher(`http://${isIP(address) === 6 ? `[${address}]` : address}:${options.probePort}/absence`, { method: 'POST', headers: { authorization: `Bearer ${options.probeToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ key, rootId: 'local', directory: target.directory }), signal, redirect: 'error' });
  if (!response.ok) { await response.body?.cancel(); throw precondition('存储探针暂不可用'); }
  const observed = AbsenceResponseSchema.parse(JSON.parse(await boundedMetricsText(response, 4096)));
  if (observed.key !== key || Date.parse(observed.observedAt) < started - 5000 || Date.parse(observed.observedAt) > Date.now() + 5000) throw precondition('存储探针回执身份或时间不符');
  const current = await k8s.get(Resources.Pod!, pod.metadata.name, options.systemNamespace, signal);
  if (!current || current.metadata.uid !== pod.metadata.uid || current.metadata.deletionTimestamp) throw precondition('存储探针实例在观测时变化');
  return observed.absent;
}
