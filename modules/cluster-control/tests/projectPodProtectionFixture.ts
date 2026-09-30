import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionPhase } from '@crewstation/contracts';
import { Resources } from '@crewstation/k8s';
import type { K8sObject } from '@crewstation/k8s';
import type { ClusterPodStopReceipt, ClusterPodStopReceipts } from '../api/projectPodProtection';
import { OPERATION, TARGET, clusterDeletionFixture, deletionControlFixture, deletionObject } from './projectDeletionFixture';

export async function podProtectionFixture(scheduled = true) {
  const cluster = await clusterDeletionFixture(), receipts = new Map<string, ClusterPodStopReceipt>(), calls: string[] = [];
  let failSave = false, now = new Date('2026-09-30T12:00:00.000Z'), confirmed: ProjectDeletionInventory;
  const store: ClusterPodStopReceipts = { get: async (_ctx, key) => receipts.get(key), save: async (_ctx, receipt) => { calls.push('save'); if (failSave) throw new Error('proof store unavailable'); receipts.set(receipt.key, receipt); } };
  const pod = deletionObject('Pod', 'original', { metadata: { name: 'original', namespace: TARGET.namespace, uid: 'original-pod', finalizers: ['external.test/retain'], annotations: { 'external.test/key': 'keep' } },
    spec: { ...(scheduled ? { nodeName: 'worker' } : {}), containers: [{ name: 'application' }], initContainers: [{ name: 'init' }], ephemeralContainers: [{ name: 'debug' }] }, status: { phase: 'Running' } });
  await cluster.put(pod);
  await cluster.k8s.create({ apiVersion: 'v1', kind: 'Node', metadata: { name: 'worker', uid: 'original-node' }, status: { conditions: [{ type: 'Ready', status: 'True' }], nodeInfo: { kubeletVersion: 'v1.36.1' } } });
  const heartbeat = async (at = now) => { await cluster.k8s.apply({ apiVersion: 'coordination.k8s.io/v1', kind: 'Lease', metadata: { name: 'worker', namespace: 'kube-node-lease', ownerReferences: [{ apiVersion: 'v1', kind: 'Node', name: 'worker', uid: 'original-node' }] }, spec: { holderIdentity: 'worker', renewTime: at.toISOString() } }); };
  await heartbeat();
  const deletion = cluster.k8s.delete.bind(cluster.k8s), patch = cluster.k8s.jsonPatch.bind(cluster.k8s);
  cluster.k8s.delete = async (ref, name, namespace, options) => { if (ref.kind !== 'Pod') return deletion(ref, name, namespace, options); const current = await cluster.k8s.get(ref, name, namespace); if (current && current.metadata.uid !== options?.preconditions?.uid) throw new Error('wrong UID'); calls.push('delete'); await cluster.k8s.mergePatch(ref, name, namespace, { metadata: { deletionTimestamp: now.toISOString() } }); return true; };
  cluster.k8s.jsonPatch = async (ref, name, namespace, changes) => { if (changes.some((change) => change.path === '/metadata/finalizers' && !JSON.stringify(change.value).includes('project-delete-stop-proof'))) calls.push('release'); return patch(ref, name, namespace, changes); };
  const source = deletionControlFixture(cluster, () => now).api.projectPodProtection(cluster.admission, store);
  const plan = async () => { confirmed = await source.inspect(TARGET); return confirmed; };
  const context = (phase: ProjectDeletionPhase, changes: Partial<ProjectDeletionContext> = {}): ProjectDeletionContext => ({ operationId: OPERATION, generation: 1, target: TARGET, confirmed, phase, ...changes });
  const read = () => cluster.k8s.get<K8sObject>(Resources.Pod!, 'original', TARGET.namespace);
  const terminate = async () => { const ended = (name: string) => ({ name, containerID: `containerd://${name}`, state: { terminated: { exitCode: 0, finishedAt: now.toISOString(), containerID: `containerd://${name}` } } }); await cluster.k8s.mergePatch(Resources.Pod!, 'original', TARGET.namespace, { status: { phase: 'Succeeded', initContainerStatuses: [ended('init')], containerStatuses: [ended('application')], ephemeralContainerStatuses: [ended('debug')] } }); };
  return { ...cluster, source, store, receipts, calls, plan, context, read, terminate, heartbeat, forget: () => deletion(Resources.Pod!, 'original', TARGET.namespace), failProofStore: (value: boolean) => { failSave = value; }, advance: (milliseconds: number) => { now = new Date(now.getTime() + milliseconds); } };
}
