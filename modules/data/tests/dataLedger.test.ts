import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, ServiceId, TaskId, UserId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { noopLogger } from '@crewstation/kernel';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { generateSecretKey } from '@crewstation/secretbox';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { DataLedger } from '../ports/ledger';
import type { PostgresProvider } from '../ports/providers';
import { createDataModule, dataMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const serviceId = '01a0bf5d-8f4b-76c5-866c-f1feda3d63c1' as ServiceId;
const projectId = '01a0bf5d-8f4b-7178-82e1-9a99060b11c2' as ProjectId;
const taskId = '01a0bf5d-8f4b-7418-8a3f-7cbb4a1fd7c3' as TaskId;
const owner: Actor = { userId: '01a0bf5d-8f4b-7793-867c-efd7527b38c4' as UserId, isAdmin: false };
const dev: Actor = { userId: '01a0bf5d-8f4b-7a4e-8eb2-04fca5c047c5' as UserId, isAdmin: false };

/** 假的数据面：只记下调用；名字为 cs_broken 的库建不出来（供给失败）。 */
function fakeProvider(calls: string[]): PostgresProvider {
  return {
    provisionDatabase: async ({ databaseName }) => { calls.push(`db:${databaseName}`); if (databaseName.startsWith('cs_broken')) throw new Error('CREATE DATABASE 被拒'); return { dsn: `postgres://r:p@h:5432/${databaseName}` }; },
    createTemporaryRole: async ({ roleName }) => { calls.push(`role:${roleName}`); return { dsn: `postgres://${roleName}:p@h:5432/x` }; },
    dropRole: async ({ roleName }) => { calls.push(`drop:${roleName}`); },
    dropDatabase: async () => undefined,
  };
}

describe.skipIf(!available)('data：数据资源与访问绑定投影进资源台账（RFC-025 第四期）', () => {
  let tdb: TestDatabase;
  let resources: ResourcesModule;
  let now = Date.now();
  const calls: string[] = [], warnings: string[] = [];
  // 台账入口可以临时「坏掉」：模拟写台账失败，数据资源的操作照常完成，补投影追上。
  let broken = false;
  let data: ReturnType<typeof createDataModule>;
  const record = async (id: string) => resources.api.get(id);

  beforeAll(async () => {
    tdb = await createTestDatabase([eventbusMigrations, dataMigrations, resourcesMigrations]);
    resources = createResourcesModule({ db: tdb.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => false });
    const guard = <T>(run: () => Promise<T>): Promise<T> => (broken ? Promise.reject(new Error('台账暂时不可用')) : run());
    const ledger: DataLedger = {
      declare: (input) => guard(() => resources.api.owner('data').declare(input)),
      get: (id) => guard(() => resources.api.get(id)),
      requestRelease: (id, reason) => guard(() => resources.api.owner('data').requestRelease(id, reason)),
      presentBindings: () => guard(async () => (await resources.api.list({ kind: 'data-binding' })).filter((entry) => entry.owner.module === 'data' && entry.desired === 'present')),
    };
    data = createDataModule({
      db: tdb.db, ledger, provider: fakeProvider(calls), clock: { now: () => new Date(now) },
      logger: { ...noopLogger, warn: (msg: string) => { warnings.push(msg); } },
      authorizer: { authorize: async (actor, _p, action) => { if (action === 'approve-data-access' && actor.userId !== owner.userId) throw new Error('forbidden'); } },
      services: { resolveServiceById: async (id) => ({ projectId, slug: id === serviceId ? 'shop' : 'broken' }) }, isAdmin: async () => false,
      settings: { defaultPlan: 'db-small', secretKeyBase64: generateSecretKey(), postgres: { adminUrl: 'postgres://unused', visibleHost: 'h', visiblePort: 5432 } },
    });
  });
  afterAll(async () => { await tdb?.drop(); });

  test('生产库、开发库各一条 database 记录：ID 沿用数据资源，期望是库与同名角色，连接串不进台账；还没观测到是分配中', async () => {
    const [prod, devDb] = await data.api.ensureServiceData(serviceId);
    const stored = await record(prod!.id);
    expect(stored).toMatchObject({ kind: 'database', owner: { module: 'data', ref: prod!.id }, projectId, desired: 'present', phase: 'provisioning' });
    expect(stored?.spec).toEqual({ children: [{ kind: 'PostgresDatabase', name: 'cs_shop' }, { kind: 'PostgresRole', name: 'cs_shop' }], engine: 'postgres', env: 'production', plan: 'db-small' });
    expect(stored?.display).toEqual({ env: 'production', database: 'cs_shop', plan: 'db-small', envVar: 'CS_DATABASE_URL' });
    expect(JSON.stringify(stored)).not.toContain('postgres://');
    expect((await record(devDb!.id))?.spec.children.map((child) => child.name)).toEqual(['cs_shop_dev', 'cs_shop_dev']);
    // 再供给一次：数据资源已就绪、不写库，台账也不产生新版本。
    const version = stored?.version;
    await data.api.ensureServiceData(serviceId);
    expect((await record(prod!.id))?.version).toBe(version);
  });

  test('绑定：等批准排队并挂在会话下；批准后期望是临时角色、领域条件生效；收回、拒绝、到期都「不要了」；开发模式没有数据面对象', async () => {
    const ro = await data.api.requestTaskBinding(dev, { taskId, serviceId }, { mode: 'diagnostic-readonly', reason: '看日志表', ttlMinutes: 30 });
    expect(await record(ro.id)).toMatchObject({ kind: 'data-binding', parentId: taskId, phase: 'pending', reason: { code: 'awaiting-approval', message: '等负责人批准' } });
    await data.api.decideTaskBinding(owner, ro.id, { approve: true });
    const granted = await record(ro.id);
    const role = `cs_t_${ro.id.replaceAll('-', '')}`;
    expect(granted?.spec.children).toEqual([{ kind: 'PostgresRole', name: role }]);
    // 临时角色建在生产库上：期望里带库名与运行角色，data-control 删角色时据此转交它拥有的对象。
    expect(granted?.spec).toMatchObject({ database: 'cs_shop', ownerRole: 'cs_shop' });
    expect(granted?.conditions.find((entry) => entry.type === 'Granted')?.status).toBe('true');
    expect(granted?.phase).toBe('provisioning');
    await data.api.revokeTaskBinding(owner, ro.id);
    expect(await record(ro.id)).toMatchObject({ desired: 'absent', releaseReason: { code: 'revoked', message: '已收回' }, phase: 'stopped' });

    const rw = await data.api.requestTaskBinding(dev, { taskId, serviceId }, { mode: 'production-change', ttlMinutes: 10 });
    await data.api.decideTaskBinding(owner, rw.id, { approve: false, decision: '先走只读' });
    expect(await record(rw.id)).toMatchObject({ desired: 'absent', releaseReason: { code: 'rejected' } });

    const devBinding = await data.api.requestTaskBinding(dev, { taskId, serviceId }, { mode: 'development', ttlMinutes: 120 });
    expect(await record(devBinding.id)).toMatchObject({ phase: 'ready', spec: { children: [], mode: 'development' } });

    const expiring = await data.api.requestTaskBinding(dev, { taskId, serviceId }, { mode: 'diagnostic-readonly', ttlMinutes: 5 });
    await data.api.decideTaskBinding(owner, expiring.id, { approve: true });
    now += 6 * 60_000;
    expect(await data.api.expireBindings()).toBe(1);
    expect(await record(expiring.id)).toMatchObject({ desired: 'absent', releaseReason: { code: 'expired', message: '已到期' } });
  });

  test('台账写失败：数据资源的操作照常完成，只记一条告警；补投影追上，已结束或已不在的绑定记录一并释放', async () => {
    const pending = await data.api.requestTaskBinding(dev, { taskId, serviceId }, { mode: 'diagnostic-readonly', ttlMinutes: 30 });
    const activeBefore = await data.api.requestTaskBinding(dev, { taskId, serviceId }, { mode: 'production-change', ttlMinutes: 30 });
    broken = true;
    const missed = await data.api.requestTaskBinding(dev, { taskId, serviceId }, { mode: 'production-change', ttlMinutes: 30 });
    await data.api.revokeTaskBinding(owner, pending.id);
    broken = false;
    expect(missed.state).toBe('requested');
    expect(warnings.filter((msg) => msg === 'data ledger projection failed')).toHaveLength(2);
    expect(await record(missed.id)).toBeUndefined();
    expect((await record(pending.id))?.desired).toBe('present');
    // 另一条记录的绑定行不见了（例如被人删了）：补投影把它的记录释放掉。
    await tdb.db.execute(`DELETE FROM data.task_bindings WHERE id = '${activeBefore.id}'`);
    const resync = data.workers[1]!;
    resync.start();
    await resync.stop();
    expect((await record(missed.id))?.phase).toBe('pending');
    expect(await record(pending.id)).toMatchObject({ desired: 'absent', releaseReason: { code: 'revoked' } });
    expect(await record(activeBefore.id)).toMatchObject({ desired: 'absent', releaseReason: { code: 'binding-missing', message: '访问绑定已不在' } });
  });

  test('供给失败：数据库记录是失败并带原因；没配台账时不投影、也没有补投影', async () => {
    const brokenService = '01a0bf5d-8f4b-76c5-866c-f1feda3d63d9' as ServiceId;
    const failing = createDataModule({
      db: tdb.db, provider: fakeProvider(calls), authorizer: { authorize: async () => undefined }, isAdmin: async () => false,
      services: { resolveServiceById: async () => ({ projectId, slug: 'broken' }) },
      settings: { defaultPlan: 'db-small', secretKeyBase64: generateSecretKey(), postgres: { adminUrl: 'postgres://unused', visibleHost: 'h', visiblePort: 5432 } },
    });
    expect(failing.workers).toHaveLength(1);
    const [prod] = await failing.api.ensureServiceData(brokenService);
    expect(prod?.state).toBe('failed');
    expect(await record(prod!.id)).toBeUndefined();
    // 同一行由配了台账的实例重试：记录写上 Failed（原因照供给的报错）。
    await data.api.ensureServiceData(brokenService);
    expect(await record(prod!.id)).toMatchObject({ phase: 'failed', reason: { code: 'provisioning-failed', message: 'CREATE DATABASE 被拒' } });
  });
});
