import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionPhase } from '@crewstation/contracts';
import { ProjectDeletionTargetSchema } from '@crewstation/contracts';
import type { K8sObject } from '@crewstation/k8s';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';
import { createClusterControlModule } from '../wiring';
import { clusterDeletionSource } from '../adapters/k8s/deletion/owner';
import { clusterProjectDeletionOwner } from '../application/deletion/projectDeletion';
import type { ClusterDeletionAdmission } from '../api/projectDeletion';
import type { LedgerRecordView } from '../ports/ledger';

export const TARGET = ProjectDeletionTargetSchema.parse({ id: '01a0f134-aefd-7380-b167-8c32b9772ffe', serviceId: '01a0f134-aefd-7380-b167-8c32b9772ffd', slug: 'delete-fixture', name: '清理夹具', namespace: 'cs-delete-fixture', state: 'active', kind: 'DigitalWorker', revision: '1', prodHost: 'delete-fixture.apps.test', previewHost: 'delete-fixture.preview.test', serviceHost: 'delete-fixture.services.test' });
export const OPERATION = '01a0f134-aefd-7380-b167-8c32b9772ffc';
export function deletionObject(kind: string, name: string, extra: Partial<K8sObject> = {}): K8sObject {
  return { apiVersion: Resources[kind]?.apiVersion ?? 'custom.test/v1', kind, metadata: { name, namespace: kind === 'Namespace' || kind === 'PersistentVolume' ? undefined : TARGET.namespace, uid: `uid-${kind}-${name}` }, ...extra };
}
export async function clusterDeletionFixture() {
  const k8s = createFakeK8sClient(), claims = new Map<string, LedgerRecordView>(), removed: string[] = [];
  const refs = Object.values(Resources).filter((entry) => entry.namespaced);
  k8s.namespacedResources = async () => refs;
  const put = async (object: K8sObject, projectId = TARGET.id) => {
    await k8s.create(object);
    claims.set(`${object.kind}/${object.metadata.namespace ?? ''}/${object.metadata.name}`, { id: object.metadata.uid!, projectId, owner: { module: 'fixture', ref: object.metadata.uid! }, kind: 'fixture', generation: 1, phase: 'ready', desired: 'present', conditions: [], spec: { children: [] }, children: [{ kind: object.kind, name: object.metadata.name, namespace: object.metadata.namespace, uid: object.metadata.uid!, phase: 'present', ready: true }] });
  };
  await put(deletionObject('Namespace', TARGET.namespace));
  const deletion = k8s.delete.bind(k8s);
  k8s.delete = async (ref, name, ns, options) => { removed.push(`${ref.kind}/${name}`); return deletion(ref, name, ns, options); };
  const ledger = { claimOf: async (child: { kind: string; namespace?: string; name: string }) => claims.get(`${child.kind}/${child.namespace ?? ''}/${child.name}`)?.id,
    get: async (id: string) => [...claims.values()].find((record) => record.id === id) };
  let sealed = false, permitted = true, generation = 1, confirmed: ProjectDeletionInventory;
  const admission: ClusterDeletionAdmission = {
    assertGrant: async (context) => { if (!permitted || context.operationId !== OPERATION || context.generation !== generation) throw precondition('删除许可失效'); },
    seal: async () => { sealed = true; }, assertSealed: async () => { if (!sealed) throw precondition('准入未封闭'); },
  };
  const owner = clusterProjectDeletionOwner(clusterDeletionSource(k8s, ledger, 'crewstation-system', admission), admission);
  const plan = async () => { confirmed = await owner.inspect(TARGET); return confirmed; };
  const run = (phase: ProjectDeletionPhase, changes: Partial<ProjectDeletionContext> = {}) => owner.run({ operationId: OPERATION, generation, target: TARGET, confirmed, phase, ...changes });
  return { k8s, owner, claims, refs, removed, put, plan, run, ledger, admission, revoke: () => { permitted = false; }, takeover: () => { generation++; }, sealed: () => sealed };
}

/** 正式公开工厂同样走集群来源；无关后台工作器不启动。 */
export function deletionControlFixture(cluster: Awaited<ReturnType<typeof clusterDeletionFixture>>, now: () => Date, volumeProbe?: { probeToken: string; probeRoot: string; probePort: number }) {
  return createClusterControlModule({ k8s: cluster.k8s, systemNamespace: 'crewstation-system', volumeProbe, isAdmin: async () => true,
    clock: { now }, orphanSweep: false, legacy: { resolveTaskId: async () => undefined, task: async () => undefined },
    ledger: { ...cluster.ledger, listLive: async () => [...cluster.claims.values()], changesSince: async () => [], latestChange: async () => 0,
      observe: async () => ({ status: 'unchanged' }), observeConditions: async () => ({ status: 'unchanged' }), adoptOrphanVolume: async () => undefined, children: async () => [] },
  });
}
