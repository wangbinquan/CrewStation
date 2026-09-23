import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId, TaskProfileDto } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createFakeK8sClient } from '@crewstation/k8s';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { queueMigrations } from '@crewstation/queue';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import type { EnvironmentLedger } from '../ports/ledger';
import { createTaskRuntimeModule, taskRuntimeMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const projectId = '01a0bf5d-8f4b-7fc7-8b88-18362617595c' as ProjectId;
const serviceId = '01a0bf5d-8f4b-77df-8856-e078a980dd3e' as ServiceId;
const profiles = [{ id: '01a0bf5d-8f4b-7001-8458-107366e7de39', name: 'coding-medium', cpu: '1', memory: '2Gi', storage: '10Gi', description: '' }] as TaskProfileDto[];
const LIMIT = 2;

// RFC-025 第二期（D31）：配了资源台账时，项目并发额度由台账在同一事务里受理——按阶段数，结束中仍占，阶段离开就自然回来。
describe.skipIf(!available)('额度经资源台账受理（RFC-025、D31）', () => {
  let tdb: TestDatabase;
  let resources: ResourcesModule;
  let ledger: EnvironmentLedger;

  beforeAll(async () => {
    tdb = await createTestDatabase([eventbusMigrations, queueMigrations, resourcesMigrations, taskRuntimeMigrations]);
    resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => LIMIT }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    const owner = resources.api.owner('task-runtime');
    ledger = { within: (tx) => owner.within(tx as object), live: async () => (await resources.api.list({})).filter((record) => record.owner.module === 'task-runtime'), occupancy: resources.api.occupancy };
  });
  afterAll(async () => { await tdb.drop(); });

  const runtime = () => createTaskRuntimeModule({
    db: tdb.db, k8s: createFakeK8sClient(), authorizer: { authorize: async () => {} }, isAdmin: async () => true, quotas: { quotaLimit: async () => LIMIT }, ledger,
    profiles: { devSessionProfile: async () => undefined, listTaskProfiles: async () => profiles, getTaskProfile: async (name) => profiles.find((p) => p.id === name) },
    services: { resolveServiceById: async () => ({ projectId, namespace: 'cs-quota', slug: 'quota', name: 'quota' }) },
    sources: { configEnv: async () => ({}), dataEnv: async () => ({}), taskDataEnv: async () => ({}) },
    settings: { taskImage: 'task:current', sessionUrl: 'ws://session/runner', systemNamespace: 'cs-system', userDomain: 'localhost', serviceDomain: 'svc.localhost', workerUid: 10001, defaultProfile: profiles[0]!.id, userAuthMiddleware: 'auth', dropIdentityHeadersMiddleware: 'drop' },
  });

  test('到上限拒绝（原因照入口的文案，台账里不多一条）；释放之后额度回来；占用数照台账，旧计数器不再用', async () => {
    const tasks = runtime();
    const first = await tasks.api.createEnvironment({ serviceId, kind: 'business', volumeMode: 'persistent' });
    const second = await tasks.api.createEnvironment({ serviceId, kind: 'business', volumeMode: 'follow-container' });
    expect(await tasks.api.runningTaskCount(projectId)).toBe(2);
    await expect(tasks.api.createEnvironment({ serviceId, kind: 'business', volumeMode: 'persistent' }))
      .rejects.toMatchObject({ kind: 'quota_exceeded', message: `并发任务已达配额上限 ${LIMIT}`, details: { projectId, limit: LIMIT, used: 2 } });
    expect((await resources.api.list({ projectId, kind: 'business-workspace' })).map((record) => record.id).sort()).toEqual([first.id, second.id].sort());
    expect(await drizzleUnitOfWork(tdb.db).read.admissions.running(projectId)).toBe(0);
    // 释放：容器回收完（这里没有观测，子对象从没见过）记录即已结束，额度自然回来——不需要做减法。
    await tasks.api.releaseEnvironment(second.id, 'business');
    expect(await tasks.api.runningTaskCount(projectId)).toBe(1);
    const third = await tasks.api.createEnvironment({ serviceId, kind: 'business', volumeMode: 'persistent' });
    expect(await resources.api.get(third.id)).toMatchObject({ kind: 'business-workspace', phase: 'provisioning' });
    expect(await tasks.api.runningTaskCount(projectId)).toBe(2);
  });
});
