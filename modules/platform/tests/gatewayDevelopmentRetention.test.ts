import { expect, test } from 'bun:test';
import { ProjectIdSchema, ServiceIdSchema, TaskIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionTarget } from '@crewstation/contracts';
import { createFakeK8sClient, LABELS } from '@crewstation/k8s';
import type { K8sObject } from '@crewstation/k8s';
import { jsonHash } from '@crewstation/kernel';
import type { GatewayRetentionSources, GatewayRetentionTasks } from '../ports/deletion/gatewayRetention';
import { gatewayDevelopmentRetention } from '../adapters/k8s/gatewayDevelopmentRetention';

async function fixture() {
  const taskId = TaskIdSchema.parse(Bun.randomUUIDv7()), projectId = ProjectIdSchema.parse(Bun.randomUUIDv7()), serviceId = ServiceIdSchema.parse(Bun.randomUUIDv7());
  const target: ProjectDeletionTarget = { id: ProjectIdSchema.parse(Bun.randomUUIDv7()), serviceId: ServiceIdSchema.parse(Bun.randomUUIDv7()), name: 'Delete', slug: 'delete-target', namespace: 'cs-delete',
    kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'delete.test', previewHost: 'preview.delete.test', serviceHost: 'delete.svc.test' };
  const task = { taskId, projectId, namespace: 'cs-foreign', podName: 'rebuilt-pod', podUid: 'current-pod-uid', pvcName: 'zzz-work', kind: 'dev-session', state: 'running', profile: 'coding-medium', volumeMode: 'follow-container' };
  const environment = { id: taskId, projectId, serviceId, kind: 'dev-session' as const, state: 'running' as const, podName: task.podName };
  const ownership = { complete: true as const, id: taskId, scope: 'project' as const, projectIds: [projectId], revision: jsonHash('original-task-owner') };
  const service = { projectId, serviceId, namespace: task.namespace, identity: 'foreign/foreign', state: 'active' as const };
  const state: { task: typeof task | undefined; environment: Awaited<ReturnType<GatewayRetentionTasks['getEnvironment']>>; ownership: Awaited<ReturnType<GatewayRetentionTasks['originalInfrastructureOwnership']>>;
    service: Awaited<ReturnType<GatewayRetentionSources['project']['resolveServiceById']>> } = { task, environment, ownership, service };
  const sources: GatewayRetentionSources = { project: { resolveServiceById: async () => state.service }, tasks: () => ({
    getEnvironment: async () => state.environment, originalInfrastructureOwnership: async () => state.ownership, listClusterTasks: async () => state.task ? [state.task] : [],
  }) };
  const pod: K8sObject = { apiVersion: 'v1', kind: 'Pod', metadata: { name: task.podName, namespace: task.namespace, uid: task.podUid,
    labels: { [LABELS.task]: taskId, [LABELS.project]: 'foreign', [LABELS.service]: 'foreign', [LABELS.workload]: 'dev-session', 'app.kubernetes.io/managed-by': 'crewstation' } },
    spec: { containers: [{ name: 'worker' }], volumes: [{ name: 'work', persistentVolumeClaim: { claimName: task.pvcName } }] },
    status: { phase: 'Running', containerStatuses: [{ name: 'worker', containerID: 'containerd://' + 'a'.repeat(64) }] } };
  const claim: K8sObject = { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: task.pvcName, namespace: task.namespace, uid: 'current-pvc-uid' }, spec: { volumeName: 'zzz-pv' }, status: { phase: 'Bound' } };
  const volume: K8sObject = { apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name: 'zzz-pv', uid: 'current-pv-uid' },
    spec: { claimRef: { name: task.pvcName, namespace: task.namespace, uid: claim.metadata.uid }, hostPath: { path: '/private/foreign-work' } }, status: { phase: 'Bound' } };
  const k8s = createFakeK8sClient(); for (const object of [pod, claim, volume]) await k8s.apply(object);
  const original = { namespace: task.namespace, name: 'original-missing-pod' }, inspect = () => gatewayDevelopmentRetention(k8s, sources)(target, taskId, original);
  return { target, taskId, projectId, serviceId, task, state, sources, pod, claim, volume, k8s, original, inspect };
}

test('current foreign development task binds public durable UID, complete Pod and full PVC/PV EOF without changing resources', async () => {
  const f = await fixture();
  for (let i = 0; i < 501; i++) {
    await f.k8s.apply({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: 'other-' + i, namespace: 'elsewhere', uid: 'other-claim-' + i }, spec: { volumeName: 'other-pv-' + i } });
    await f.k8s.apply({ apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name: 'other-pv-' + i, uid: 'other-volume-' + i }, spec: { hostPath: { path: '/other/' + i } } });
  }
  const proof = await f.inspect(); expect(proof).toMatchObject({ taskId: f.taskId, projectId: f.projectId, serviceId: f.serviceId, podUid: f.task.podUid, originalAbsent: true });
  expect(proof!.volumes).toHaveLength(1); expect(proof!.volumes[0]).toMatchObject({ uid: f.claim.metadata.uid, pvUid: f.volume.metadata.uid });
  expect(proof!.assets.pods![0]!.containersComplete).toBe(true); expect(f.k8s.deleted).toEqual([]);
  f.claim.metadata.resourceVersion = 'unrelated-watch-change'; await f.k8s.apply(f.claim);
  expect((await f.inspect())!.volumes[0]!.digest).toBe(proof!.volumes[0]!.digest);
  f.claim.metadata.annotations = { approvedContent: 'changed' }; await f.k8s.apply(f.claim);
  expect((await f.inspect())!.volumes[0]!.digest).not.toBe(proof!.volumes[0]!.digest);
});

test('missing/target/mismatched public task ownership or current durable UID never produces a foreign current baseline', async () => {
  for (const scenario of ['missing-task', 'missing-environment', 'paused', 'wrong-kind', 'wrong-project', 'wrong-name', 'no-uid', 'replaced-uid', 'missing-owner', 'platform-owner', 'target-owner', 'conflicting-owner', 'missing-service', 'wrong-service', 'wrong-namespace', 'archived-service']) {
    const f = await fixture();
    if (scenario === 'missing-task') f.state.task = undefined;
    if (scenario === 'missing-environment') f.state.environment = undefined;
    if (scenario === 'paused') f.state.environment = { ...f.state.environment!, state: 'paused' };
    if (scenario === 'wrong-kind') f.state.task = { ...f.task, kind: 'business' };
    if (scenario === 'wrong-project') f.state.task = { ...f.task, projectId: f.target.id };
    if (scenario === 'wrong-name') f.state.task = { ...f.task, podName: 'another-pod' };
    if (scenario === 'no-uid') f.state.task = { ...f.task, podUid: '' };
    if (scenario === 'replaced-uid') f.state.task = { ...f.task, podUid: 'replaced-uid' };
    if (scenario === 'missing-owner') f.state.ownership = undefined;
    if (scenario === 'platform-owner') f.state.ownership = { ...f.state.ownership!, scope: 'platform', projectIds: [] };
    if (scenario === 'target-owner') f.state.environment = { ...f.state.environment!, projectId: f.target.id };
    if (scenario === 'conflicting-owner') f.state.ownership = { ...f.state.ownership!, projectIds: [f.projectId, f.target.id] };
    if (scenario === 'missing-service') f.state.service = undefined;
    if (scenario === 'wrong-service') f.state.service = { ...f.state.service!, serviceId: f.target.serviceId! };
    if (scenario === 'wrong-namespace') f.state.service = { ...f.state.service!, namespace: 'elsewhere' };
    if (scenario === 'archived-service') f.state.service = { ...f.state.service!, state: 'archived' };
    expect(await f.inspect()).toBeUndefined(); expect(f.k8s.deleted).toEqual([]);
  }
});

test('existing old Pod, shared/target bindings, unknown/partial/unbound/replaced volumes and incomplete sources keep the current consumer blocked', async () => {
  for (const scenario of ['old-pod', 'shared-pod', 'target-pod-spec', 'no-mounted-pvc', 'wrong-mounted-pvc', 'additional-mounted-pvc', 'target-pvc', 'unknown-volume', 'shared-volume', 'shared-local-volume', 'shared-claim', 'replaced-claim', 'deleting-pvc', 'unbound-pv', 'missing-pv']) {
    const f = await fixture();
    if (scenario === 'old-pod') await f.k8s.apply({ ...f.pod, metadata: { ...f.pod.metadata, name: f.original.name, uid: 'old-now-present' } });
    if (scenario === 'shared-pod') await f.k8s.apply({ ...f.pod, metadata: { ...f.pod.metadata, name: 'shared-pod', uid: 'other-consumer' } });
    if (scenario === 'target-pod-spec') f.pod['spec'] = { ...(f.pod['spec'] as object), ref: f.target.id };
    if (scenario === 'no-mounted-pvc') f.pod['spec'] = { ...(f.pod['spec'] as object), volumes: [] };
    if (scenario === 'wrong-mounted-pvc') f.pod['spec'] = { ...(f.pod['spec'] as object), volumes: [{ name: 'work', persistentVolumeClaim: { claimName: 'unproven-pvc' } }] };
    if (scenario === 'additional-mounted-pvc') f.pod['spec'] = { ...(f.pod['spec'] as object), volumes: [{ name: 'work', persistentVolumeClaim: { claimName: f.task.pvcName } }, { name: 'shared', persistentVolumeClaim: { claimName: 'other-pvc' } }] };
    if (scenario === 'target-pvc') f.claim.metadata.annotations = { sharedProject: f.target.id };
    if (scenario === 'unknown-volume') f.volume['spec'] = { claimRef: (f.volume['spec'] as { claimRef: unknown }).claimRef };
    if (scenario === 'shared-volume') await f.k8s.apply({ ...f.volume, metadata: { ...f.volume.metadata, name: 'shared-physical-pv', uid: 'other-volume' } });
    if (scenario === 'shared-local-volume') await f.k8s.apply({ ...f.volume, metadata: { name: 'shared-local-pv', uid: 'other-volume' }, spec: { local: { path: '/private/foreign-work/../foreign-work' } } });
    if (scenario === 'shared-claim') await f.k8s.apply({ ...f.claim, metadata: { ...f.claim.metadata, name: 'shared-pvc', uid: 'other-claim', namespace: f.target.namespace } });
    if (scenario === 'replaced-claim') f.claim.metadata.uid = 'replaced-pvc';
    if (scenario === 'deleting-pvc') f.claim.metadata.deletionTimestamp = '2026-10-06T00:00:00Z';
    if (scenario === 'unbound-pv') f.volume['status'] = { phase: 'Released' };
    if (scenario === 'missing-pv') f.claim['spec'] = { volumeName: 'missing-volume' };
    for (const object of [f.pod, f.claim, f.volume]) await f.k8s.apply(object);
    expect(await f.inspect()).toBeUndefined(); expect(f.k8s.deleted).toEqual([]);
  }
  const f = await fixture(), listPage = f.k8s.listPage;
  f.k8s.listPage = async (...args) => { if (args[0].kind === 'PersistentVolume') throw new Error('unavailable volume source'); return listPage(...args); };
  await expect(f.inspect()).rejects.toThrow('unavailable volume source');
  f.k8s.listPage = async (...args) => args[0].kind === 'Pod' ? listPage(...args) : { items: [], resourceVersion: '', continue: '' };
  await expect(f.inspect()).rejects.toThrow('完整分页');
});
