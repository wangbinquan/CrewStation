import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionPhase, TaskVolumeTarget } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { Resources } from '@crewstation/k8s';
import type { ClusterVolumeReclaimReceipt, ClusterVolumeReclamationStore } from '../api/projectVolumeReclamation';
import { kubernetesProjectVolumeReclamation } from '../adapters/k8s/deletion/volumeReclamation';
import { clusterDeletionFixture, deletionControlFixture, deletionObject, OPERATION, TARGET } from './projectDeletionFixture';

export async function volumeReclamationFixture(pending = false, localPath = false) {
  const f = await clusterDeletionFixture(), rows = new Map<string, ClusterVolumeReclaimReceipt>(), calls: string[] = [], known: TaskVolumeTarget[] = [];
  let confirmed: ProjectDeletionInventory, absent = true;
  const now = () => new Date(), options = { systemNamespace: 'crewstation-system', probeToken: 'test-probe-token', probeRoot: '/volumes', probePort: 8095 };
  await f.put(deletionObject('PersistentVolumeClaim', 'work', { metadata: { name: 'work', namespace: TARGET.namespace, uid: 'original-pvc' }, spec: pending ? {} : { volumeName: 'original-pv' } }));
  const bind = async () => { await f.k8s.mergePatch(Resources.PersistentVolumeClaim!, 'work', TARGET.namespace, { spec: { volumeName: 'original-pv' } });
    await f.k8s.create({ apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name: 'original-pv', uid: 'original-pv-uid', finalizers: localPath ? ['kubernetes.io/pv-protection'] : ['external-provisioner.volume.kubernetes.io/finalizer'], ...(localPath ? { annotations: { 'pv.kubernetes.io/provisioned-by': 'rancher.io/local-path', 'local.path.provisioner/selected-node': 'worker' } } : {}) },
      spec: { claimRef: { uid: 'original-pvc', namespace: TARGET.namespace, name: 'work' }, persistentVolumeReclaimPolicy: 'Delete', ...(localPath ? { hostPath: { path: '/volumes/original-directory' } } : { csi: { driver: 'test.csi', volumeHandle: 'secret-provider-handle' } }) } }); };
  if (!pending) await bind();
  if (localPath) {
    await f.k8s.create({ apiVersion: 'v1', kind: 'Node', metadata: { name: 'worker', uid: 'original-node' }, status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: { kubeletVersion: 'v1.36.1' } } });
    await f.k8s.create({ apiVersion: 'coordination.k8s.io/v1', kind: 'Lease', metadata: { name: 'worker', namespace: 'kube-node-lease', ownerReferences: [{ apiVersion: 'v1', kind: 'Node', name: 'worker', uid: 'original-node' }] }, spec: { holderIdentity: 'worker', renewTime: now().toISOString() } });
    await f.k8s.create({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'probe', namespace: options.systemNamespace, uid: 'original-probe', labels: { app: 'cs-storage-probe' } }, spec: { nodeName: 'worker', volumes: [{ name: 'root', hostPath: { path: '/volumes', type: 'Directory' } }], containers: [{ volumeMounts: [{ name: 'root', mountPath: '/volumes', readOnly: true }] }] }, status: { podIP: '10.0.0.1', conditions: [{ type: 'Ready', status: 'True' }] } });
  }
  const store: ClusterVolumeReclamationStore = { known: async () => known, get: async (_context, key) => rows.get(key), pin: async (_context, key, target) => { calls.push('pin'); const old = rows.get(key); if (old && jsonHash(old.target) !== jsonHash(target)) throw precondition('原 target 变化'); rows.set(key, old ?? { key, target, digest: null, observedAt: null }); }, reclaimed: async (_context, key, digest, observedAt) => { calls.push('proof'); const row = rows.get(key)!; rows.set(key, { ...row, digest, observedAt }); } };
  const fetcher = (async (_url: unknown, init?: RequestInit) => { calls.push('physical-probe'); const body = JSON.parse(String(init?.body)); if (body.directory !== 'original-directory' || (init?.headers as Record<string, string>).authorization !== `Bearer ${options.probeToken}`) throw new Error('wrong physical probe identity'); return Response.json({ key: body.key, absent, observedAt: now().toISOString() }); }) as typeof fetch;
  const source = localPath ? kubernetesProjectVolumeReclamation(f.k8s, f.ledger, f.admission, store, options, now, fetcher) : deletionControlFixture(f, now, options).api.projectVolumeReclamation(f.admission, store);
  const plan = async () => { confirmed = await source.inspect(TARGET); return confirmed; };
  const context = (phase: ProjectDeletionPhase, changes: Partial<ProjectDeletionContext> = {}): ProjectDeletionContext => ({ operationId: OPERATION, generation: 1, target: TARGET, confirmed, phase, ...changes });
  return { ...f, source, store, rows, calls, known, plan, context, bind, backendGone: () => f.k8s.delete(Resources.PersistentVolume!, 'original-pv'), physicalAbsent: (value: boolean) => { absent = value; } };
}
