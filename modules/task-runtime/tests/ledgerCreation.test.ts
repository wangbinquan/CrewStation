import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId, TaskId, TaskProfileDto } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createFakeK8sClient } from '@crewstation/k8s';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { queueMigrations } from '@crewstation/queue';
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
const profiles = [{ id: '01a0bf5d-8f4b-7001-8458-107366e7de39', name: 'coding-medium', cpu: '1', memory: '2Gi', storage: '10Gi', description: '' }] as TaskProfileDto[];

describe.skipIf(!available)('工作区容器由资源中心建出（RFC-025 I25）', () => {
  let tdb: TestDatabase;
  let resources: ResourcesModule;
  let ledger: EnvironmentLedger;
  const k8s = createFakeK8sClient();
  const runtime = () => createTaskRuntimeModule({
    db: tdb.db, k8s, authorizer: { authorize: async () => {} }, isAdmin: async () => true, quotas: { quotaLimit: async () => 4 }, ledger, creation: 'ledger',
    profiles: { devSessionProfile: async () => undefined, listTaskProfiles: async () => profiles, getTaskProfile: async (name) => profiles.find((p) => p.id === name) },
    services: { resolveServiceById: async () => ({ projectId, namespace: 'cs-lc', slug: 'lc', name: 'lc' }) },
    sources: { configEnv: async () => ({ GREETING: 'hi' }), dataEnv: async () => ({}), taskDataEnv: async () => ({}) },
    checkout: { checkoutFor: async () => ({ repoUrl: 'http://git/lc.git', credentialSecretName: 'git-checkout-lc' }) },
    settings: { taskImage: 'task:current', sessionUrl: 'ws://session/runner', systemNamespace: 'cs-system', userDomain: 'localhost', serviceDomain: 'svc.localhost', workerUid: 10001, defaultProfile: profiles[0]!.id, userAuthMiddleware: 'auth', dropIdentityHeadersMiddleware: 'drop' },
  });

  beforeAll(async () => {
    tdb = await createTestDatabase([eventbusMigrations, queueMigrations, resourcesMigrations, taskRuntimeMigrations]);
    resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    const owner = resources.api.owner('task-runtime');
    ledger = { within: (tx) => owner.within(tx as object), live: async () => (await resources.api.list({})).filter((record) => record.owner.module === 'task-runtime'), occupancy: resources.api.occupancy };
  });
  afterAll(async () => { await tdb.drop(); });

  const provisioning = async (id: string) => (await resources.api.get(id))?.conditions.find((entry) => entry.type === 'Provisioning')?.status;

  test('受理只写期望：集群里什么都不建，记录带 Pod、Runner Secret、预览与卷的期望（没有凭据），要资源中心建', async () => {
    const tasks = runtime();
    const created = await tasks.api.createEnvironment({ serviceId, kind: 'dev-session', branch: 'main', preview: { command: ['bun', 'dev'], port: 3000, healthPath: '/' }, labels: { 'crewstation.io/project': 'lc', 'crewstation.io/service': 'lc' } });
    expect([...k8s.objects.values()]).toEqual([]);
    const workspace = (await resources.api.get(created.id))!;
    expect(workspace.spec.children.map((child) => `${child.kind}/${child.name}`)).toEqual([`Pod/${created.podName}`, `Secret/${created.podName}-runner-1`, `Service/${created.podName}`, `IngressRoute/${created.podName}`]);
    expect(workspace.spec['pod']).toMatchObject({ image: 'task:current', workload: 'dev-session', project: 'lc', pvc: `${created.podName}-work`, secret: `${created.podName}-runner-1`, checkout: { repoUrl: 'http://git/lc.git', branch: 'main', credentialSecretName: 'git-checkout-lc' } });
    expect(workspace.spec['preview']).toEqual({ port: 3000, kind: 'dev-session', route: { host: 'dev.lc.localhost', middlewares: [{ name: 'drop', namespace: 'cs-system' }, { name: 'auth', namespace: 'cs-system' }] } });
    expect(JSON.stringify(workspace.spec)).not.toContain('CS_RUNNER_TOKEN');
    expect(await provisioning(created.id)).toBe('true');
    const volume = (await resources.api.list({ parentId: created.id, kind: 'volume' }))[0]!;
    expect(volume.spec['pvc']).toEqual({ size: '10Gi', labels: { 'crewstation.io/task': created.id, 'crewstation.io/project': 'lc' } });
    expect(await provisioning(volume.id)).toBe('true');
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
});
