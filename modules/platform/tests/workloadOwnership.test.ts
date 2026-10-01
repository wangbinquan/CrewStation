import { expect, test } from 'bun:test';
import { ProjectIdSchema, ReleaseIdSchema, ServiceIdSchema, TaskIdSchema } from '@crewstation/contracts';
import type { WorkloadIdentity } from '@crewstation/contracts';
import { createFakeK8sClient } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';
import type { ResolvedService } from '@crewstation/module-project';
import type { EnvironmentDto } from '@crewstation/module-task-runtime';
import { nativeWorkloadOwnership } from '../adapters/k8s/workloadOwnership';

async function fixture(kind: 'service' | 'dev-session' | 'business-task' = 'service') {
  const projectId = ProjectIdSchema.parse(Bun.randomUUIDv7()), serviceId = ServiceIdSchema.parse(Bun.randomUUIDv7()), releaseId = ReleaseIdSchema.parse(Bun.randomUUIDv7()), taskId = TaskIdSchema.parse(Bun.randomUUIDv7());
  const scope = { projectId, serviceId }, k8s = createFakeK8sClient();
  const pod = { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'source-original', namespace: 'cs-source', uid: 'original-pod', labels: {
    'app.kubernetes.io/managed-by': 'crewstation', 'crewstation.io/project': 'source', 'crewstation.io/service': 'source', 'crewstation.io/workload': kind,
    'crewstation.io/release': releaseId, 'crewstation.io/task': taskId, 'crewstation.io/slot': 'blue',
  } }, status: { podIP: '10.1.2.3', phase: 'Running' } };
  await k8s.apply(pod);
  const workload: WorkloadIdentity = { identity: 'source/source', project: 'source', service: 'source', kind, taskId,
    pod: { uid: 'original-pod', name: pod.metadata.name, namespace: pod.metadata.namespace, ip: pod.status.podIP } };
  const state: { scope?: typeof scope; service?: ResolvedService; env?: EnvironmentDto; admission: 'open' | 'closed' | 'unreadable' } = {
    scope, service: { ...scope, slug: 'source', name: 'source', identity: 'source/source', namespace: 'cs-source', kind: 'DigitalWorker', state: 'active' }, admission: 'open',
    env: { ...scope, id: taskId, kind: kind === 'business-task' ? 'business' : 'dev-session', state: 'running', podName: pod.metadata.name, connected: true, volumeMode: 'persistent', profile: 'test', traceId: 'a'.repeat(32), createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString() },
  };
  const project = { resolveServiceById: async (id: typeof serviceId) => { expect(id).toBe(state.scope!.serviceId); return state.service; }, assertProjectAvailable: async (id: typeof projectId) => {
    expect(id).toBe(projectId); if (state.admission === 'closed') throw precondition('Original project deleting'); if (state.admission === 'unreadable') throw new Error('Database unavailable');
  } };
  const release = { sourceOwnership: async (id: typeof releaseId) => id === releaseId ? state.scope : undefined }, tasks = { getEnvironment: async (id: typeof taskId) => id === taskId ? state.env : undefined };
  const source = nativeWorkloadOwnership(k8s, () => project, () => release, () => tasks);
  return { k8s, pod, workload, state, source, scope, releaseId, taskId, project, release, tasks };
}

test('原发布 UUID 与实际 Pod 精确匹配后才返回归属；同名新项目、不同实例和来源不可读不获授权', async () => {
  const f = await fixture();
  expect(await f.source.resolve(f.workload)).toEqual(f.scope);
  const originalService = f.state.service;
  for (const patch of [{ projectId: ProjectIdSchema.parse(Bun.randomUUIDv7()) }, { serviceId: ServiceIdSchema.parse(Bun.randomUUIDv7()) }, { namespace: 'cs-replacement' }, { identity: 'replacement/replacement' }]) {
    f.state.service = { ...originalService!, ...patch }; expect(await f.source.resolve(f.workload)).toBeUndefined();
  }
  f.state.service = undefined; expect(await f.source.resolve(f.workload)).toBeUndefined(); f.state.service = originalService;
  for (const patch of [{ pod: undefined }, { kind: 'platform' as const }, { project: 'replacement' }, { service: 'replacement' }, { pod: { ...f.workload.pod!, uid: 'replacement-pod' } }, { pod: { ...f.workload.pod!, ip: '10.1.2.4' } }, { pod: { ...f.workload.pod!, namespace: 'other' } }])
    expect(await f.source.resolve({ ...f.workload, ...patch })).toBeUndefined();
  for (const patch of [{ phase: 'Succeeded' }, { phase: 'Failed' }]) { await f.k8s.apply({ ...f.pod, status: { ...f.pod.status, ...patch } }); expect(await f.source.resolve(f.workload)).toBeUndefined(); }
  await f.k8s.apply(f.pod);
  f.state.admission = 'closed'; expect(await f.source.resolve(f.workload)).toBeUndefined();
  f.state.admission = 'unreadable'; await expect(f.source.resolve(f.workload)).rejects.toThrow('Database unavailable');
  f.state.admission = 'open'; f.state.scope = undefined; expect(await f.source.resolve(f.workload)).toBeUndefined();
});

test('实际 Pod 的管理方、工作负载、发布与专用绑定不符时拒绝；原版本未 Ready 不影响已有服务调用', async () => {
  const f = await fixture(), labels = f.pod.metadata.labels;
  for (const patch of [{ 'app.kubernetes.io/managed-by': 'unknown' }, { 'crewstation.io/workload': 'business-task' }, { 'crewstation.io/release': '' }, { 'crewstation.io/release': 'unknown' }]) {
    await f.k8s.apply({ ...f.pod, metadata: { ...f.pod.metadata, labels: { ...labels, ...patch } } }); expect(await f.source.resolve(f.workload)).toBeUndefined();
  }
  await f.k8s.apply(f.pod);
  const source = { releaseId: f.releaseId, podUid: 'original-pod', ip: '10.1.2.3', physicalSlot: 'blue' as const, ready: false };
  expect(await f.source.resolve({ ...f.workload, source })).toEqual(f.scope);
  for (const patch of [{ releaseId: ReleaseIdSchema.parse(Bun.randomUUIDv7()) }, { physicalSlot: 'green' as const }, { podUid: 'replacement' }, { ip: '10.1.2.4' }]) expect(await f.source.resolve({ ...f.workload, source: { ...source, ...patch } })).toBeUndefined();
  await f.k8s.apply({ ...f.pod, metadata: { ...f.pod.metadata, deletionTimestamp: new Date().toISOString() } });
  expect(await f.source.resolve(f.workload)).toEqual(f.scope);
});

test('开发及业务原 task UUID 保留合法来源；原任务、类型、Pod 名或子执行 UID 不匹配时拒绝', async () => {
  for (const kind of ['dev-session', 'business-task'] as const) {
    const f = await fixture(kind), env = f.state.env!;
    expect(await f.source.resolve(f.workload)).toEqual(f.scope);
    for (const patch of [{ taskId: undefined }, { taskId: TaskIdSchema.parse(Bun.randomUUIDv7()) }]) expect(await f.source.resolve({ ...f.workload, ...patch })).toBeUndefined();
    for (const patch of [{ state: 'released' as const }, { podName: 'replacement' }, { kind: 'profile-test' as const }]) { f.state.env = { ...env, ...patch }; expect(await f.source.resolve(f.workload)).toBeUndefined(); }
    f.state.env = { ...env, native: { purpose: 'agent', parentTaskId: f.taskId, agentId: 'agent', runnerId: 'runner', state: 'running', podUid: 'replacement', profile: { name: 'test', cpu: '1', memory: '1Gi', storage: '1Gi' } } };
    expect(await f.source.resolve(f.workload)).toBeUndefined(); f.state.env.native!.podUid = 'original-pod'; expect(await f.source.resolve(f.workload)).toEqual(f.scope);
    f.state.env = env;
    const developmentSource = { taskId: f.taskId, podUid: 'original-pod', podName: f.pod.metadata.name, ip: '10.1.2.3', ready: true };
    expect(await f.source.resolve({ ...f.workload, developmentSource })).toEqual(f.scope);
    for (const patch of [{ podUid: 'replacement' }, { podName: 'replacement' }, { taskId: TaskIdSchema.parse(Bun.randomUUIDv7()) }, { ip: '10.1.2.4' }]) expect(await f.source.resolve({ ...f.workload, developmentSource: { ...developmentSource, ...patch } })).toBeUndefined();
    f.state.env = undefined; expect(await f.source.resolve(f.workload)).toBeUndefined();
  }
});

test('升级前 release/task 标签只经原 ID 别名解析，不能用同名目录补认缺失来源', async () => {
  for (const kind of ['service', 'dev-session'] as const) {
    const f = await fixture(kind), field = kind === 'service' ? 'crewstation.io/release' : 'crewstation.io/task';
    await f.k8s.apply({ ...f.pod, metadata: { ...f.pod.metadata, labels: { ...f.pod.metadata.labels, [field]: 'original-legacy-key' } } });
    expect(await f.source.resolve(f.workload)).toBeUndefined();
    const normalized = nativeWorkloadOwnership(f.k8s, () => f.project, () => f.release, () => f.tasks, async (requested, key) => {
      expect(requested).toBe(kind === 'service' ? 'release' : 'task'); expect(key).toBe('original-legacy-key'); return kind === 'service' ? f.releaseId : f.taskId;
    });
    expect(await normalized.resolve(f.workload)).toEqual(f.scope);
    const absent = nativeWorkloadOwnership(f.k8s, () => f.project, () => undefined, () => undefined, async () => undefined);
    expect(await absent.resolve(f.workload)).toBeUndefined();
  }
});
