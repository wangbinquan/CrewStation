import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId, TaskId, TaskProfileDto, UserId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createFakeK8sClient, pvcObject, Resources, taskPodObject } from '@crewstation/k8s';
import { newId } from '@crewstation/kernel';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import type { Worker } from '@crewstation/queue';
import { queueMigrations } from '@crewstation/queue';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { CreateNativeExecutionInput } from '../api/moduleApi';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { canonicalNativeIntent, nativeIntentMatches } from '../domain/physicalIdentity';
import { POD_CREATE_GRACE_MS } from '../domain/taskEnvironment';
import type { EnvironmentLedger } from '../ports/ledger';
import { NATIVE_EXECUTION_JOB_KIND } from '../ports/repositories';
import { createTaskRuntimeModule, taskRuntimeMigrations } from '../wiring';

// RFC-025 I25 第二步：执行环境（CLI、headless Agent、子任务）由资源中心建出——受理只写期望（节点、父工作区、所属工作区标签与受理意图注解，
// 不含凭据），不进准备队列；建 Secret 时回头要值（父工作区得还在运行、连着），建出后交回 Pod 与 Secret 的实例即「启动中」；
// 父工作区换了实例、要值时已断开，或过了建出宽限仍在排队，都照「准备失败」收尾，只结束这一个 Agent。
const available = await testDatabaseAvailable();
const projectId = '01a0bf5d-8f4b-7fc7-8b88-183626175b01' as ProjectId;
const serviceId = '01a0bf5d-8f4b-77df-8856-e078a980db02' as ServiceId;
const user = '01a0bf5d-8f4b-7e44-886a-b79b12465b03' as UserId;
const profiles = [{ id: '01a0bf5d-8f4b-7001-8458-107366e7de39', name: 'coding-medium', cpu: '1', memory: '2Gi', storage: '10Gi', description: '' }] as TaskProfileDto[];

describe.skipIf(!available)('执行环境由资源中心建出（RFC-025 I25 第二步）', () => {
  let tdb: TestDatabase;
  let resources: ResourcesModule;
  let tasks: ReturnType<typeof createTaskRuntimeModule>;
  const k8s = createFakeK8sClient();
  let time = Date.parse('2026-09-24T06:00:00Z');
  const parent = { id: '' as TaskId, podName: '', pvcName: '', podUid: '', pvcUid: '', token: '' };
  const input = (patch: Partial<CreateNativeExecutionInput> = {}): CreateNativeExecutionInput => ({
    id: newId('tsk') as TaskId, parentTaskId: parent.id, purpose: 'cli', createdBy: user, agentId: newId('agt'), terminalId: crypto.randomUUID(), runnerId: crypto.randomUUID(), fingerprint: 'a'.repeat(64), ...patch,
  });
  const load = async (id: string) => (await drizzleUnitOfWork(tdb.db).read.environments.getById(id as TaskId))!;
  const condition = async (id: string, type: string) => (await resources.api.get(id))?.conditions.find((entry) => entry.type === type)?.status;
  const preparationJobs = async (id: string) => (await tdb.db.execute(sql`SELECT count(*)::int AS n FROM platform_infra.jobs WHERE kind = ${NATIVE_EXECUTION_JOB_KIND} AND payload->>'taskId' = ${id}`) as unknown as Array<{ n: number }>)[0]!.n;

  beforeAll(async () => {
    tdb = await createTestDatabase([eventbusMigrations, queueMigrations, resourcesMigrations, taskRuntimeMigrations]);
    resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => 8 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    const owner = resources.api.owner('task-runtime');
    const ledger: EnvironmentLedger = { within: (tx) => owner.within(tx as object), live: async () => (await resources.api.list({})).filter((record) => record.owner.module === 'task-runtime'), occupancy: resources.api.occupancy };
    tasks = createTaskRuntimeModule({
      db: tdb.db, k8s, authorizer: { authorize: async () => {} }, isAdmin: async () => true, quotas: { quotaLimit: async () => 8 }, ledger, creation: 'ledger', clock: { now: () => new Date(time) },
      profiles: { devSessionProfile: async () => undefined, listTaskProfiles: async () => profiles, getTaskProfile: async (name) => profiles.find((p) => p.id === name) },
      services: { resolveServiceById: async () => ({ projectId, namespace: 'cs-le', slug: 'le', name: 'le' }) },
      sources: { configEnv: async () => ({ GREETING: 'hi' }), dataEnv: async () => ({}), taskDataEnv: async () => ({}) },
      settings: { taskImage: 'task:current', sessionUrl: 'ws://session/runner', systemNamespace: 'cs-system', userDomain: 'localhost', serviceDomain: 'svc.localhost', workerUid: 10001, defaultProfile: profiles[0]!.id, userAuthMiddleware: 'auth', dropIdentityHeadersMiddleware: 'drop' },
    });
    // 父工作区也由资源中心建出：这里像调和器那样把它的 Pod 与卷放进假集群，交回实例，Runner 连上。
    const created = await tasks.api.createEnvironment({ serviceId, kind: 'dev-session', labels: { 'crewstation.io/project': 'le', 'crewstation.io/service': 'le' } });
    const env = await load(created.id);
    const pod = await k8s.create(taskPodObject({ name: env.podName, namespace: env.namespace, taskId: env.id, workload: 'dev-session', project: 'le', service: 'le', image: 'task:current', workerUid: 10001,
      resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, workVolume: { pvc: env.pvcName }, envFromSecret: `${env.podName}-runner-1` }));
    await k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { spec: { nodeName: 'worker-one' }, status: { phase: 'Running' } });
    const volume = await k8s.create(pvcObject({ name: env.pvcName, namespace: env.namespace, size: '10Gi', labels: { 'crewstation.io/task': env.id } }));
    await k8s.mergePatch(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace, { status: { phase: 'Bound' } });
    const values = await tasks.api.runnerValues(env.id);
    await tasks.api.bindWorkload(env.id, pod.metadata.uid!);
    await tasks.api.onRunnerConnected(env.id, values['CS_RUNNER_TOKEN']!);
    Object.assign(parent, { id: env.id, podName: env.podName, pvcName: env.pvcName, podUid: pod.metadata.uid!, pvcUid: volume.metadata.uid!, token: values['CS_RUNNER_TOKEN']! });
  });
  afterAll(async () => { await tdb.drop(); });

  test('受理只写期望、不进准备队列：节点、父工作区、所属工作区标签与意图注解进记录，凭据不在；补投的准备作业什么也不做', async () => {
    const cli = await tasks.api.createNativeExecution(input());
    const env = await load(cli.id);
    expect(env.render).toEqual({ image: 'task:current', workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, start: 1, execution: { workspacePod: parent.podName } });
    const record = (await resources.api.get(cli.id))!;
    expect(record.spec.children.map((child) => `${child.kind}/${child.name}`)).toEqual([`Pod/${env.podName}`, `Secret/${env.podName}-runner`]);
    expect(record.spec['pod']).toEqual({
      image: 'task:current', workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, workload: 'dev-session', project: 'le', service: 'le', pvc: parent.pvcName, secret: `${env.podName}-runner`,
      nodeName: 'worker-one', labels: { 'crewstation.io/workspace-task': parent.id }, annotations: { 'crewstation.io/cli-intent': canonicalNativeIntent(env.id, env.native!) },
      workspace: { pod: parent.podName, podUid: parent.podUid, pvcUid: parent.pvcUid },
    });
    expect(JSON.stringify(record.spec)).not.toContain('CS_RUNNER_TOKEN');
    // 注解是受理时写进投影的，清理时照库里读回的环境比对（档位对象的键序被 jsonb 重排过），要认得出来。
    expect(nativeIntentMatches((record.spec['pod'] as { annotations: Record<string, string> }).annotations['crewstation.io/cli-intent'], env)).toBe(true);
    expect([await condition(cli.id, 'Provisioning'), await condition(cli.id, 'Prepared')]).toEqual(['true', 'false']);
    expect(await preparationJobs(cli.id)).toBe(0);
    // 对账补投排队中的执行环境（作业崩溃时的兜底）：这一条由资源中心建，作业到了什么也不建。
    await tasks.api.reconcile();
    expect(await preparationJobs(cli.id)).toBe(1);
    await tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at = now() - interval '1 second'`);
    await (tasks.workers[1] as Worker).runOnce();
    expect(await k8s.get(Resources.Pod!, env.podName, env.namespace)).toBeUndefined();
    expect(await k8s.get(Resources.Secret!, `${env.podName}-runner`, env.namespace)).toBeUndefined();
    expect((await load(cli.id)).native?.state).toBe('queued');
  });

  test('建 Secret 时要值、交回实例：执行环境进入启动中，记下 Pod 与 Runner Secret 的实例，不再要建', async () => {
    const cli = await tasks.api.createNativeExecution(input());
    const values = await tasks.api.runnerValues(cli.id as TaskId);
    expect(values).toMatchObject({ GREETING: 'hi', CS_CANONICAL_RUNNER_TASK_ID: cli.id });
    expect((await tasks.api.verifyRunnerToken(cli.id as TaskId, values['CS_RUNNER_TOKEN']!)).ok).toBe(true);
    await tasks.api.bindWorkload(cli.id as TaskId, 'uid-cli-pod', 'uid-cli-secret');
    const env = await load(cli.id);
    expect(env.native).toMatchObject({ state: 'starting', podUid: 'uid-cli-pod', secretUid: 'uid-cli-secret', preparedAt: new Date(time).toISOString() });
    expect(env.message).toBe('此CLI的执行容器已创建，等待调度和连接');
    expect(env.startup?.stages[0]).toMatchObject({ kind: 'queue', state: 'succeeded' });
    expect([await condition(cli.id, 'Provisioning'), await condition(cli.id, 'Prepared')]).toEqual(['false', 'true']);
    await expect(tasks.api.runnerValues(cli.id as TaskId)).rejects.toMatchObject({ kind: 'precondition' });
    // 调和器重试再交一次：已不在排队，不改实例。
    await tasks.api.bindWorkload(cli.id as TaskId, 'uid-other', 'uid-other');
    expect((await load(cli.id)).native).toMatchObject({ podUid: 'uid-cli-pod', secretUid: 'uid-cli-secret' });
  });

  test('父工作区换了实例：判这个执行环境准备失败（工作区已变化）并进入清理；再报一次、报给工作区都不改', async () => {
    const agent = await tasks.api.createNativeExecution(input({ purpose: 'agent', terminalId: undefined }));
    await tasks.api.workloadUnavailable(agent.id as TaskId, 'workspace-changed');
    const env = await load(agent.id);
    expect(env).toMatchObject({ state: 'releasing', native: { state: 'cleaning', failureReason: '启动期间原工作区实例或工作卷已变化，此Agent未启动' } });
    expect(env.startup?.stages.find((stage) => stage.state === 'failed')?.error?.code).toBe('workspace-lost');
    expect((await resources.api.get(agent.id))?.desired).toBe('absent');
    await tasks.api.workloadUnavailable(agent.id as TaskId, 'workspace-changed');
    expect((await load(agent.id)).updatedAt).toEqual(env.updatedAt);
    await tasks.api.workloadUnavailable(parent.id, 'workspace-changed');
    expect(await load(parent.id)).toMatchObject({ state: 'running', connected: true });
  });

  test('过了建出宽限仍在排队（资源中心一直没建出来）：对账判准备失败；宽限内不动', async () => {
    const late = await tasks.api.createNativeExecution(input());
    time += POD_CREATE_GRACE_MS - 1_000;
    await tasks.api.reconcile();
    expect((await load(late.id)).native?.state).toBe('queued');
    time += 2_000;
    await tasks.api.reconcile();
    const env = await load(late.id);
    expect(env.native).toMatchObject({ state: 'cleaning', failureReason: '此CLI的执行环境准备失败，其他 Agent、窗口与工作树保持' });
    expect(env.startup?.stages.find((stage) => stage.state === 'failed')?.error?.code).toBe('pod-create-failed');
  });

  test('要值时父工作区已断开：拒绝给值，并判这个执行环境失败（原工作区已断开）', async () => {
    const orphan = await tasks.api.createNativeExecution(input());
    await tasks.api.onRunnerDisconnected(parent.id, parent.token);
    await expect(tasks.api.runnerValues(orphan.id as TaskId)).rejects.toMatchObject({ kind: 'precondition', message: '原工作区已经断开或释放，此CLI未启动' });
    const env = await load(orphan.id);
    expect(env.native).toMatchObject({ state: 'cleaning', failureReason: '原工作区已经断开或释放，此CLI未启动' });
    expect(env.startup?.stages.find((stage) => stage.state === 'failed')?.error?.code).toBe('workspace-lost');
  });
});
