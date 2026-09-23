import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, ResourceChild, ServiceId, TaskProfileDto } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import type { Logger } from '@crewstation/kernel';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { queueMigrations } from '@crewstation/queue';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { resyncLedger } from '../application/ledgerResync';
import { recoverableDevSession } from '../application/rebuildInspection';
import type { EnvironmentLedger } from '../ports/ledger';
import { ledgerResyncWorker } from '../workers/ledgerResyncWorker';
import type { TaskRuntimeModuleDeps } from '../wiring';
import { createTaskRuntimeModule, taskRuntimeMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const projectId = '01a0bf5d-8f4b-7fc7-8b88-18362617594b' as ProjectId;
const serviceId = '01a0bf5d-8f4b-77df-8856-e078a980dc2f' as ServiceId;
const profiles = [{ id: '01a0bf5d-8f4b-7001-8458-107366e7de39', name: 'coding-medium', cpu: '1', memory: '2Gi', storage: '10Gi', description: '' }] as TaskProfileDto[];

function runtimeDeps(db: TestDatabase['db'], k8s: ReturnType<typeof createFakeK8sClient>, ledger?: EnvironmentLedger, logger?: Logger): TaskRuntimeModuleDeps {
  return {
    db, k8s, authorizer: { authorize: async () => {} }, isAdmin: async () => true, quotas: { quotaLimit: async () => 4 },
    profiles: { devSessionProfile: async () => undefined, listTaskProfiles: async () => profiles, getTaskProfile: async (name) => profiles.find((p) => p.id === name) },
    services: { resolveServiceById: async () => ({ projectId, namespace: 'cs-qa', slug: 'qa', name: 'qa' }) },
    sources: { configEnv: async () => ({}), dataEnv: async () => ({}), taskDataEnv: async () => ({}) },
    settings: { taskImage: 'task:current', sessionUrl: 'ws://session/runner', systemNamespace: 'cs-system', userDomain: 'localhost', serviceDomain: 'svc.localhost', workerUid: 10001, defaultProfile: profiles[0]!.id, userAuthMiddleware: 'auth', dropIdentityHeadersMiddleware: 'drop' },
    ...(ledger ? { ledger } : {}), ...(logger ? { logger } : {}),
  };
}

const runnerToken = async (k8s: ReturnType<typeof createFakeK8sClient>, podName: string) => {
  const pod = (await k8s.get(Resources.Pod!, podName, 'cs-qa'))!;
  return (pod.spec as { containers: Array<{ env: Array<{ name: string; value: string }> }> }).containers[0]!.env.find((v) => v.name === 'CS_RUNNER_TOKEN')!.value;
};
const podChild = (name: string, patch: Partial<ResourceChild> = {}): ResourceChild => ({ kind: 'Pod', namespace: 'cs-qa', name, uid: `uid-${name}`, phase: 'Running', ready: true, ...patch });

describe.skipIf(!available)('任务环境投影进资源台账（RFC-025 第二期）', () => {
  let tdb: TestDatabase;
  let resources: ResourcesModule;
  let ledger: EnvironmentLedger;
  const warnings: string[] = [];
  const logger: Logger = { debug: () => undefined, info: () => undefined, warn: (msg, fields) => { warnings.push(`${msg} ${JSON.stringify(fields ?? {})}`); }, error: () => undefined, child: () => logger };

  beforeAll(async () => {
    tdb = await createTestDatabase([eventbusMigrations, queueMigrations, resourcesMigrations, taskRuntimeMigrations]);
    resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    const owner = resources.api.owner('task-runtime');
    ledger = { within: (tx) => owner.within(tx as object), live: async () => (await resources.api.list({})).filter((record) => record.owner.module === 'task-runtime'), occupancy: resources.api.occupancy };
  });
  afterAll(async () => { await tdb.drop(); });

  test('开发会话从创建到释放：台账记录按环境的每次落库同步，阶段由观测与条件算出', async () => {
    const k8s = createFakeK8sClient();
    const runtime = createTaskRuntimeModule(runtimeDeps(tdb.db, k8s, ledger, logger));
    const created = await runtime.api.createEnvironment({ serviceId, kind: 'dev-session', branch: 'work' });
    const workspace = await resources.api.get(created.id);
    expect(workspace).toMatchObject({ kind: 'dev-workspace', owner: { module: 'task-runtime', ref: created.id }, purpose: 'development-workspace', phase: 'provisioning', display: { branch: 'work' } });
    expect(workspace?.startup?.state).toBe('running');
    const volume = (await resources.api.list({ parentId: created.id }))[0];
    expect(volume).toMatchObject({ kind: 'volume', children: [{ kind: 'PersistentVolumeClaim', name: `${created.podName}-work`, phase: 'absent' }] });
    await resources.api.observe({ child: podChild(created.podName) });
    expect((await resources.api.get(created.id))?.phase).toBe('starting');
    const token = await runnerToken(k8s, created.podName);
    await runtime.api.onRunnerConnected(created.id, token);
    expect(await resources.api.get(created.id)).toMatchObject({ phase: 'ready', conditions: expect.arrayContaining([expect.objectContaining({ type: 'RunnerConnected', status: 'true' })]) });
    await runtime.api.onRunnerDisconnected(created.id, token);
    expect((await resources.api.get(created.id))?.phase).toBe('degraded');
    await runtime.api.releaseEnvironment(created.id, 'user');
    expect(await resources.api.get(created.id)).toMatchObject({ desired: 'absent', phase: 'stopping', reason: { code: 'user', message: '用户释放' } });
    await resources.api.observe({ child: podChild(created.podName), gone: true });
    expect((await resources.api.get(created.id))?.phase).toBe('stopped');
    expect((await resources.api.get(volume!.id))?.desired).toBe('absent');
    expect(warnings).toEqual([]);
  });

  test('受理之后的投影写失败不挡住环境操作：只回滚保存点、记一条告警；受理本身（额度）以台账为准，台账出错就不受理', async () => {
    const admitted = { id: 'x', desired: 'present' as const, owner: { module: 'task-runtime', ref: 'x' }, conditions: [] };
    const writer = (admit: () => Promise<typeof admitted>) => ({ declare: async () => { throw new Error('台账暂时不可用'); }, admit, requestRelease: async () => { throw new Error('x'); }, report: async () => { throw new Error('x'); }, find: async () => undefined });
    const broken: EnvironmentLedger = { within: () => writer(async () => admitted), live: async () => [], occupancy: async () => 0 };
    const runtime = createTaskRuntimeModule(runtimeDeps(tdb.db, createFakeK8sClient(), broken, logger));
    const created = await runtime.api.createEnvironment({ serviceId, kind: 'business', volumeMode: 'persistent' });
    expect((await runtime.api.getEnvironment(created.id))?.state).toBe('creating');
    expect(await resources.api.get(created.id)).toBeUndefined();
    expect(warnings.some((line) => line.startsWith('resource ledger projection failed') && line.includes('台账暂时不可用'))).toBe(true);
    const down: EnvironmentLedger = { within: () => writer(async () => { throw new Error('台账暂时不可用'); }), live: async () => [], occupancy: async () => 0 };
    const refused = createTaskRuntimeModule(runtimeDeps(tdb.db, createFakeK8sClient(), down, logger));
    await expect(refused.api.createEnvironment({ serviceId, kind: 'business', volumeMode: 'persistent' })).rejects.toThrow('台账暂时不可用');
  });

  test('补投影：部署前就存在的环境、投影失败漏掉的环境，由补投影写进台账；已释放的跟着「不要了」', async () => {
    const plain = createTaskRuntimeModule(runtimeDeps(tdb.db, createFakeK8sClient()));
    const before = await plain.api.createEnvironment({ serviceId, kind: 'business', volumeMode: 'persistent' });
    expect(await resources.api.get(before.id)).toBeUndefined();
    const uow = drizzleUnitOfWork(tdb.db, { ledger, logger });
    expect(await resyncLedger(uow, ledger, logger)).toBeGreaterThanOrEqual(1);
    expect(await resources.api.get(before.id)).toMatchObject({ kind: 'business-workspace', desired: 'present' });
    await plain.api.releaseEnvironment(before.id, 'business');
    expect((await resources.api.get(before.id))?.desired).toBe('present');
    await resyncLedger(uow, ledger, logger);
    expect(await resources.api.get(before.id)).toMatchObject({ desired: 'absent', releaseReason: { code: 'business', message: '业务释放' } });
  });

  test('失败保留期满（资源中心把记录改成「不要了」）：补投影把环境记为已释放，不删卷、不能再恢复；保留期从失败时刻算', async () => {
    const k8s = createFakeK8sClient();
    const runtime = createTaskRuntimeModule(runtimeDeps(tdb.db, k8s, ledger, logger));
    const created = await runtime.api.createEnvironment({ serviceId, kind: 'dev-session', branch: 'work' });
    await runtime.api.markFailed(created.id, '容器运行失败');
    const uow = drizzleUnitOfWork(tdb.db, { ledger, logger });
    const failedAt = (await uow.read.environments.getById(created.id))!.updatedAt;
    const record = await resources.api.get(created.id);
    expect(record).toMatchObject({ phase: 'failed' });
    // 保留到期 = 判失败的时刻（环境进入 failed 那次落库）＋ 72 小时。
    expect(record?.retainUntil?.toISOString()).toBe(new Date(failedAt.getTime() + 72 * 3_600_000).toISOString());
    await expect(recoverableDevSession(uow.read, created.projectId)).resolves.toMatchObject({ id: created.id });
    // 资源中心的维护作业到期后做的就是这一步（resources 的 expireRetention）。
    await resources.api.owner('task-runtime').requestRelease(created.id, { code: 'retention-expired', message: '失败保留期已满，平台自动回收' });
    const refused = await recoverableDevSession(uow.read, created.projectId).then(() => 'resolved', (error: Error) => error.message);
    expect(refused).toContain('72 小时保留期');
    await resyncLedger(uow, ledger, logger);
    expect(await runtime.api.getEnvironment(created.id)).toMatchObject({ state: 'released', message: 'released: retention-expired' });
    const volume = (await resources.api.list({ parentId: created.id, includeStopped: true }))[0];
    expect(volume).toMatchObject({ kind: 'volume', desired: 'present' });
    expect((await resources.api.get(created.id))?.releaseReason?.code).toBe('retention-expired');
    expect(k8s.deleted.filter((key) => key.includes('PersistentVolumeClaim'))).toEqual([]);
  });

  test('补投影工作器：启动即跑一次、此后按周期；失败只记告警；停止时等本轮跑完', async () => {
    let calls = 0;
    const seen: string[] = [];
    const quiet: Logger = { debug: () => undefined, info: (msg) => { seen.push(msg); }, warn: (msg) => { seen.push(msg); }, error: () => undefined, child: () => quiet };
    const worker = ledgerResyncWorker(async () => { calls += 1; if (calls === 2) throw new Error('台账暂时不可用'); return 3; }, quiet, 30);
    worker.start();
    worker.start();
    const deadline = Date.now() + 2_000;
    while (calls < 3 && Date.now() < deadline) await Bun.sleep(10);
    await worker.stop();
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(seen).toContain('resource ledger resynced');
    expect(seen).toContain('resource ledger resync failed');
  });
});
