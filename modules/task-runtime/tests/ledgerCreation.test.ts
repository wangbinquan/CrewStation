import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId, TaskId, TaskProfileDto } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createFakeK8sClient, pvcObject, Resources, taskPodObject } from '@crewstation/k8s';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { queueMigrations } from '@crewstation/queue';
import { newResourceId } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { awaitingPodCreation, transition } from '../domain/taskEnvironment';
import type { EnvironmentLedger } from '../ports/ledger';
import { createTaskRuntimeModule, taskRuntimeMigrations } from '../wiring';

// RFC-025 I25：配了台账并由资源中心建出时，受理只写期望（不含凭据），卷、Runner Secret、Pod 与预览由调和器照记录建；
// 建 Secret 时回头要值（新签发的令牌只存哈希），Pod 建出后交回实例；恢复即再启动一次，换一个 Runner Secret。
const available = await testDatabaseAvailable();
const projectId = '01a0bf5d-8f4b-7fc7-8b88-183626175a01' as ProjectId;
const serviceId = '01a0bf5d-8f4b-77df-8856-e078a980da02' as ServiceId;
const projectServices = new Map<ProjectId, ServiceId>([[projectId, serviceId]]);
function serviceFor(project: ProjectId): ServiceId {
  let original = projectServices.get(project);
  if (!original) { original = newResourceId() as ServiceId; projectServices.set(project, original); }
  return original;
}
const profiles = [{ id: '01a0bf5d-8f4b-7001-8458-107366e7de39', name: 'coding-medium', cpu: '1', memory: '2Gi', storage: '10Gi', description: '' }] as TaskProfileDto[];

describe.skipIf(!available)('工作区容器由资源中心建出（RFC-025 I25）', () => {
  let tdb: TestDatabase;
  let resources: ResourcesModule;
  let ledger: EnvironmentLedger;
  const k8s = createFakeK8sClient();
  let tokensIssued = 0;
  const ownedCheckout = { checkoutFor: async () => { throw new Error('不该再写按服务的 Secret'); }, repositoryFor: async () => ({ repoUrl: 'http://git/lc.git' }), credentialFor: async () => ({ token: `git-${++tokensIssued}` }) };
  const runtime = (checkout: Parameters<typeof createTaskRuntimeModule>[0]['checkout'] = { checkoutFor: async () => ({ repoUrl: 'http://git/lc.git', credentialSecretName: 'git-checkout-lc' }) }, project = projectId, catalog = profiles) => createTaskRuntimeModule({
    db: tdb.db, k8s, authorizer: { authorize: async () => {} }, isAdmin: async () => true, quotas: { quotaLimit: async () => 4 }, ledger, creation: 'ledger',
    profiles: { devSessionProfile: async () => undefined, listTaskProfiles: async () => catalog, getTaskProfile: async (name) => catalog.find((p) => p.id === name) },
    services: { resolveServiceById: async () => ({ projectId: project, namespace: 'cs-lc', slug: 'lc', name: 'lc' }) },
    sources: { configEnv: async () => ({ GREETING: 'hi' }), dataEnv: async () => ({}), taskDataEnv: async () => ({}) },
    checkout,
    settings: { taskImage: 'task:current', sessionUrl: 'ws://session/runner', systemNamespace: 'cs-system', userDomain: 'localhost', serviceDomain: 'svc.localhost', workerUid: 10001, defaultProfile: profiles[0]!.id, userAuthMiddleware: 'auth', dropIdentityHeadersMiddleware: 'drop', previewRateMiddlewares: ['rate-limit-user', 'rate-limit-host'] },
  });

  beforeAll(async () => {
    tdb = await createTestDatabase([eventbusMigrations, queueMigrations, resourcesMigrations, taskRuntimeMigrations]);
    resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    const owner = resources.api.owner('task-runtime');
    ledger = { within: (tx) => owner.within(tx as object), live: async () => (await resources.api.list({})).filter((record) => record.owner.module === 'task-runtime'), occupancy: resources.api.occupancy };
  });
  afterAll(async () => { await tdb.drop(); });

  const provisioning = async (id: string) => (await resources.api.get(id))?.conditions.find((entry) => entry.type === 'Provisioning')?.status;

  test('RFC-027：并发固定 ID 只准入一次，重建模块和套餐删除后仍返回原回执，参数变化冲突', async () => {
    const project = '01a0bf5d-8f4b-7fc7-8b88-183626175b01' as ProjectId;
    const serviceId = serviceFor(project);
    const admission = { id: '01a0bf5d-8f4b-7fc7-8b88-183626175b02' as TaskId, fingerprint: 'a'.repeat(64) };
    const input = { admission, serviceId, kind: 'business' as const, volumeMode: 'persistent' as const, businessStorage: 'isolated-v1' as const };
    const tasks = runtime(undefined, project);
    const results = await Promise.all(Array.from({ length: 8 }, () => tasks.api.createEnvironment(input)));
    for (const result of results) expect(result).toEqual(results[0]!);
    expect(results[0]!.id).toBe(admission.id);
    expect((await resources.api.get(admission.id))?.spec['pod']).toMatchObject({ businessStorage: { version: 1, ownerTaskId: admission.id, initialize: true } });
    await expect(tasks.api.createEnvironment({ ...input, businessStorage: undefined })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await resources.api.occupancy(project)).toBe(1);
    expect(await drizzleUnitOfWork(tdb.db).read.environments.listByProject(project)).toHaveLength(1);
    expect(await runtime(undefined, project, []).api.createEnvironment(input)).toEqual(results[0]!);
    await expect(tasks.api.createEnvironment({ ...input, volumeMode: 'follow-container' })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(tasks.api.createEnvironment({ ...input, admission: { ...admission, fingerprint: 'b'.repeat(64) } })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(tasks.api.createEnvironment({ ...input, serviceId: '01a0bf5d-8f4b-7fc7-8b88-183626175b03' as ServiceId })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await resources.api.occupancy(project)).toBe(1);
    expect([...k8s.objects.values()]).toEqual([]);
  });

  test('RFC-027：额度拒绝不留任务或排队记录，释放额度后同一 ID 可重试，终态重放不复活', async () => {
    const project = '01a0bf5d-8f4b-7fc7-8b88-183626175c01' as ProjectId;
    const serviceId = serviceFor(project);
    const tasks = runtime(undefined, project);
    const occupied = await Promise.all(Array.from({ length: 4 }, () => tasks.api.createEnvironment({ serviceId, kind: 'business' })));
    const input = { serviceId, kind: 'business' as const, admission: { id: '01a0bf5d-8f4b-7fc7-8b88-183626175c02' as TaskId, fingerprint: 'c'.repeat(64) } };
    await expect(tasks.api.createEnvironment(input)).rejects.toMatchObject({ kind: 'quota_exceeded' });
    const uow = drizzleUnitOfWork(tdb.db, { ledger });
    expect(await uow.read.environments.getById(input.admission.id)).toBeUndefined();
    expect(await resources.api.get(input.admission.id)).toBeUndefined();
    const first = (await uow.read.environments.getById(occupied[0]!.id))!;
    await uow.run((scope) => scope.environments.update(transition(first, 'failed', new Date())));
    const created = await tasks.api.createEnvironment(input);
    expect(created.id).toBe(input.admission.id);
    expect(await resources.api.occupancy(project)).toBe(4);
    const env = (await uow.read.environments.getById(created.id))!;
    await uow.run((scope) => scope.environments.update(transition(env, 'failed', new Date())));
    expect((await tasks.api.createEnvironment(input)).state).toBe('failed');
    expect(await resources.api.occupancy(project)).toBe(3);
  });

  test('RFC-027：固定准入拒绝非业务任务和无效 ID／摘要，不产生资源', async () => {
    const tasks = runtime();
    const input = { serviceId, kind: 'business' as const, admission: { id: '01a0bf5d-8f4b-7fc7-8b88-183626175d01' as TaskId, fingerprint: 'd'.repeat(64) } };
    await expect(tasks.api.createEnvironment({ ...input, kind: 'dev-session' })).rejects.toMatchObject({ kind: 'validation' });
    await expect(tasks.api.createEnvironment({ ...input, admission: { ...input.admission, id: '../unsafe' as TaskId } })).rejects.toMatchObject({ kind: 'validation' });
    await expect(tasks.api.createEnvironment({ ...input, admission: { ...input.admission, fingerprint: '' } })).rejects.toMatchObject({ kind: 'validation' });
    expect(await resources.api.get(input.admission.id)).toBeUndefined();
  });

  test('受理只写期望：集群里什么都不建，记录带 Pod、Runner Secret、预览与卷的期望（没有凭据），要资源中心建', async () => {
    const tasks = runtime();
    const created = await tasks.api.createEnvironment({ serviceId, kind: 'dev-session', branch: 'main', preview: { command: ['bun', 'dev'], port: 3000, healthPath: '/' }, labels: { 'crewstation.io/project': 'lc', 'crewstation.io/service': 'lc' } });
    expect([...k8s.objects.values()]).toEqual([]);
    const workspace = (await resources.api.get(created.id))!;
    expect(workspace.spec.children.map((child) => `${child.kind}/${child.name}`)).toEqual([`Pod/${created.podName}`, `Secret/${created.podName}-runner-1`, `Service/${created.podName}`]);
    expect(workspace.spec['pod']).toMatchObject({ image: 'task:current', workload: 'dev-session', project: 'lc', pvc: `${created.podName}-work`, secret: `${created.podName}-runner-1`, checkout: { repoUrl: 'http://git/lc.git', branch: 'main', credentialSecretName: 'git-checkout-lc' } });
    expect(workspace.spec['preview']).toEqual({ port: 3000, kind: 'dev-session' });
    const route = (await resources.api.list({ parentId: created.id, kind: 'route' }))[0]!;
    expect(route.spec).toMatchObject({ children: [{ kind: 'IngressRoute', namespace: 'cs-lc', name: created.podName }], host: 'dev.lc.localhost', target: { namespace: 'cs-lc', service: created.podName, port: 80 } });
    expect(route.spec['middlewares']).toEqual([{ name: 'drop', namespace: 'cs-system' }, { name: 'auth', namespace: 'cs-system' }, { name: 'rate-limit-user' }, { name: 'rate-limit-host' }]);
    expect(await resources.api.claimOf({ kind: 'IngressRoute', namespace: 'cs-lc', name: created.podName })).toBe(route.id);
    expect(JSON.stringify(workspace.spec)).not.toContain('CS_RUNNER_TOKEN');
    expect(await provisioning(created.id)).toBe('true');
    const volume = (await resources.api.list({ parentId: created.id, kind: 'volume' }))[0]!;
    expect(volume.spec['pvc']).toEqual({ size: '10Gi', labels: { 'crewstation.io/task': created.id, 'crewstation.io/project': 'lc' } });
    expect(await provisioning(volume.id)).toBe('true');
  });

  test('检出凭据归这一次启动：受理只要仓库地址（不签令牌、不写按服务的 Secret），凭据 Secret 是记录的子对象，令牌建的时候才签', async () => {
    // 一个项目只能有一个开发会话：这条用另一个项目。
    const checkoutProject = '01a0bf5d-8f4b-7fc7-8b88-183626175a09' as ProjectId, serviceId = serviceFor(checkoutProject);
    const tasks = runtime(ownedCheckout, checkoutProject);
    const created = await tasks.api.createEnvironment({ serviceId, kind: 'dev-session', branch: 'feature', labels: { 'crewstation.io/project': 'lc', 'crewstation.io/service': 'lc' } });
    expect(tokensIssued).toBe(0);
    const env = (await drizzleUnitOfWork(tdb.db).read.environments.getById(created.id as TaskId))!;
    expect(env.render?.checkout).toEqual({ repoUrl: 'http://git/lc.git', branch: 'feature' });
    const workspace = (await resources.api.get(created.id))!;
    expect(workspace.spec.children.map((child) => child.name)).toEqual([created.podName, `${created.podName}-runner-1`, `${created.podName}-checkout-1`]);
    expect(workspace.spec['pod']).toMatchObject({ checkout: { repoUrl: 'http://git/lc.git', branch: 'feature', credentialSecretName: `${created.podName}-checkout-1`, ownedCredential: true } });
    expect(await tasks.api.checkoutValues(created.id as TaskId)).toEqual({ token: 'git-1' });
    await tasks.api.bindWorkload(created.id as TaskId, 'uid-dev-pod');
    await expect(tasks.api.checkoutValues(created.id as TaskId)).rejects.toMatchObject({ kind: 'precondition' });
    // 旧形状（受理时写好按服务的 Secret）与不检出的，都不向这里要令牌。
    const legacy = await runtime().api.createEnvironment({ serviceId: serviceFor(projectId), kind: 'business', labels: {} });
    await expect(runtime().api.checkoutValues(legacy.id as TaskId)).rejects.toMatchObject({ kind: 'precondition' });
    expect(tokensIssued).toBe(1);
  });

  test('建 Secret 时要值：给出配置与新签发的令牌（只存哈希）；Pod 交回后不再要建、再要值被拒', async () => {
    const tasks = runtime();
    const created = await tasks.api.createEnvironment({ serviceId, kind: 'business', volumeMode: 'persistent', labels: { 'crewstation.io/project': 'lc', 'crewstation.io/service': 'lc' } });
    const values = await tasks.api.runnerValues(created.id as TaskId);
    expect(values).toMatchObject({ GREETING: 'hi', CS_CANONICAL_RUNNER_TASK_ID: created.id });
    expect((await tasks.api.verifyRunnerToken(created.id as TaskId, values['CS_RUNNER_TOKEN']!)).ok).toBe(true);
    await tasks.api.bindWorkload(created.id as TaskId, 'uid-pod-1');
    const env = await drizzleUnitOfWork(tdb.db).read.environments.getById(created.id as TaskId);
    expect(env).toMatchObject({ podUid: 'uid-pod-1', state: 'creating' });
    expect(env?.startup?.stages[0]).toMatchObject({ kind: 'queue', state: 'succeeded' });
    expect(await provisioning(created.id)).toBe('false');
    await expect(tasks.api.runnerValues(created.id as TaskId)).rejects.toMatchObject({ kind: 'precondition' });
    // 已绑定的再交一次（调和器重试）不改实例。
    await tasks.api.bindWorkload(created.id as TaskId, 'uid-pod-2');
    expect((await drizzleUnitOfWork(tdb.db).read.environments.getById(created.id as TaskId))?.podUid).toBe('uid-pod-1');
    await expect(tasks.api.bindWorkload('01a0bf5d-8f4b-7fc7-8b88-183626175aff' as TaskId, 'x')).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('恢复即再启动一次：换一个 Runner Secret、清掉实例，重新要资源中心建；建出宽限从这次启动算', async () => {
    const tasks = runtime(), uow = drizzleUnitOfWork(tdb.db);
    const created = await tasks.api.createEnvironment({ serviceId, kind: 'business', volumeMode: 'persistent', labels: { 'crewstation.io/project': 'lc', 'crewstation.io/service': 'lc' } });
    await tasks.api.bindWorkload(created.id as TaskId, 'uid-pod-a');
    const bound = (await uow.read.environments.getById(created.id as TaskId))!;
    await uow.run((scope) => scope.environments.update(transition(transition(bound, 'running', new Date()), 'paused', new Date())));
    const resumed = await tasks.api.resumeEnvironment(created.id as TaskId);
    expect(resumed.state).toBe('creating');
    const env = (await uow.read.environments.getById(created.id as TaskId))!;
    expect(env).toMatchObject({ render: { start: 2 } });
    expect(env.podUid).toBeUndefined();
    expect((await resources.api.get(created.id))?.spec.children.map((child) => child.name)).toContain(`${created.podName}-runner-2`);
    expect(await provisioning(created.id)).toBe('true');
    expect([...k8s.objects.values()].filter((object) => object.kind === 'Pod')).toEqual([]);
    const later = new Date(Date.parse(env.startup!.startedAt) + 60_000);
    expect(awaitingPodCreation({ ...env, createdAt: new Date(0) }, later)).toBe(true);
  });
  test('RFC-027：子 Agent 继承父卷布局与 UID，日志按自己的环境 ID 隔离', async () => {
    const project = '01a0bf5d-8f4b-7fc7-8b88-183626175d01' as ProjectId;
    const serviceId = serviceFor(project);
    const parentId = '01a0bf5d-8f4b-7fc7-8b88-183626175d02' as TaskId;
    const childId = '01a0bf5d-8f4b-7fc7-8b88-183626175d03' as TaskId;
    const tasks = runtime(undefined, project), uow = drizzleUnitOfWork(tdb.db);
    await tasks.api.createEnvironment({ admission: { id: parentId, fingerprint: 'd'.repeat(64) }, businessStorage: 'isolated-v1', serviceId, kind: 'business', volumeMode: 'persistent' });
    const env = (await uow.read.environments.getById(parentId))!;
    const pod = await k8s.create(taskPodObject({ name: env.podName, namespace: env.namespace, taskId: env.id, workload: 'business-task', project: 'lc', service: 'lc', image: 'task:current', workerUid: 10001,
      resources: profiles[0]!, workVolume: { pvc: env.pvcName }, businessStorage: { ...env.render!.businessStorage!, initialize: true } }));
    await k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { spec: { nodeName: 'node-a' }, status: { phase: 'Running' } });
    await k8s.create(pvcObject({ name: env.pvcName, namespace: env.namespace, size: '10Gi', labels: { 'crewstation.io/task': parentId } }));
    await k8s.mergePatch(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace, { status: { phase: 'Bound' } });
    const values = await tasks.api.runnerValues(parentId);
    await tasks.api.bindWorkload(parentId, pod.metadata.uid!);
    await tasks.api.onRunnerConnected(parentId, values['CS_RUNNER_TOKEN']!);
    await tasks.api.createNativeExecution({ id: childId, parentTaskId: parentId, purpose: 'subtask', agentId: 'agent-a', runnerId: crypto.randomUUID(), fingerprint: 'attempt-a' });
    expect((await uow.read.environments.getById(childId))!.render?.businessStorage).toEqual({ version: 1, ownerTaskId: parentId });
    expect((await resources.api.get(childId))?.spec['pod']).toMatchObject({ pvc: env.pvcName, businessStorage: { version: 1, ownerTaskId: parentId, initialize: false } });
    expect(await tasks.api.runnerValues(childId)).toMatchObject({ CS_WORKER_UID: '10001', CS_WORKER_GID: '10001' });
    expect(await resources.api.occupancy(project)).toBe(2);
  });
});
