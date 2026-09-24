import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { DataPlaneObject } from '../domain/dataPlane';
import type { DataPlaneReader } from '../ports/dataPlane';
import { createDataControlModule } from '../wiring';

const available = await testDatabaseAvailable();
const PROJECT = '01a0bf5d-8f4b-7c01-8e19-e226732a75e1' as ProjectId;

/** 手动拨的数据面：用例决定库与角色在不在。 */
function manualDataPlane() {
  const databases = new Map<string, DataPlaneObject>(), roles = new Map<string, DataPlaneObject>();
  let snapshots = 0, closed = false;
  const reader: DataPlaneReader = {
    snapshot: async () => { snapshots += 1; return { databases: new Map(databases), roles: new Map(roles), observedAt: new Date().toISOString() }; },
    close: async () => { closed = true; },
  };
  return { reader, databases, roles, snapshots: () => snapshots, closed: () => closed };
}

async function until(label: string, check: () => Promise<boolean> | boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await Bun.sleep(10);
  }
}

describe.skipIf(!available)('data-control：数据面观测写回台账（RFC-025 第四期）', () => {
  let database: TestDatabase;
  let resources: ResourcesModule;
  const plane = manualDataPlane();
  let control: ReturnType<typeof createDataControlModule>;

  beforeAll(async () => {
    database = await createTestDatabase([resourcesMigrations]);
    resources = createResourcesModule({ db: database.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => false });
    control = createDataControlModule({
      reader: plane.reader, logger: noopLogger, observer: { pollMs: 20, resyncMs: 60 },
      ledger: {
        get: (id) => resources.api.get(id), changesSince: resources.api.changesSince, latestChange: resources.api.latestChange,
        listLive: async () => [...await resources.api.list({ kind: 'database' }), ...await resources.api.list({ kind: 'data-binding' })],
        observe: (input) => resources.api.observe(input),
      },
    });
    control.observer.start();
  });
  afterAll(async () => { await control.observer.stop(); await database.drop(); });

  test('库与角色都在：数据库记录运行中（OID 当 UID）；库被人删了：记消失、回到分配中，建回后又运行中', async () => {
    plane.databases.set('cs_shop', { name: 'cs_shop', oid: '16390' });
    plane.roles.set('cs_shop', { name: 'cs_shop', oid: '16389' });
    const record = await resources.api.owner('data').declare({ kind: 'database', ref: 'db-shop', projectId: PROJECT, spec: { children: [{ kind: 'PostgresDatabase', name: 'cs_shop' }, { kind: 'PostgresRole', name: 'cs_shop' }], engine: 'postgres' } });
    // 新声明的记录随尾随台账变更核对，不必等全量。
    await until('数据库运行中', async () => (await resources.api.get(record.id))?.phase === 'ready');
    expect((await resources.api.get(record.id))?.children.map((child) => [child.kind, child.uid, child.phase])).toEqual([['PostgresDatabase', '16390', 'Present'], ['PostgresRole', '16389', 'Present']]);
    plane.databases.delete('cs_shop');
    await until('库消失', async () => (await resources.api.get(record.id))?.children.find((child) => child.kind === 'PostgresDatabase')?.phase === 'absent');
    expect((await resources.api.get(record.id))?.phase).toBe('provisioning');
    plane.databases.set('cs_shop', { name: 'cs_shop', oid: '16500' });
    await until('建回后又运行中', async () => (await resources.api.get(record.id))?.phase === 'ready');
    expect((await resources.api.get(record.id))?.children.find((child) => child.kind === 'PostgresDatabase')?.uid).toBe('16500');
  });

  test('访问绑定：批准生效、临时角色在即运行中；角色过了 VALID UNTIL 记 Expired；受理释放后角色删掉即已结束', async () => {
    const role = 'cs_t_0123456789abcdef';
    const data = resources.api.owner('data');
    const binding = await data.declare({ kind: 'data-binding', ref: 'binding-1', projectId: PROJECT, spec: { children: [{ kind: 'PostgresRole', name: role }], mode: 'diagnostic-readonly' }, conditions: [{ type: 'Prepared', status: 'true' }, { type: 'Granted', status: 'true' }] });
    await until('角色还没建出来：分配中', async () => (await resources.api.get(binding.id))?.phase === 'provisioning');
    plane.roles.set(role, { name: role, oid: '17001', validUntil: new Date(Date.now() + 3_600_000).toISOString() });
    await until('绑定运行中', async () => (await resources.api.get(binding.id))?.phase === 'ready');
    plane.roles.set(role, { name: role, oid: '17001', validUntil: new Date(Date.now() - 1_000).toISOString() });
    await until('角色记 Expired', async () => (await resources.api.get(binding.id))?.children[0]?.phase === 'Expired');
    await data.requestRelease(binding.id, { code: 'expired', message: '已到期' });
    await until('角色还在：结束中', async () => (await resources.api.get(binding.id))?.phase === 'stopping');
    plane.roles.delete(role);
    await until('角色删掉：已结束', async () => (await resources.api.get(binding.id))?.phase === 'stopped');
    expect(control.stats().recorded).toBeGreaterThan(0);
    expect(plane.snapshots()).toBeGreaterThan(0);
  });

  test('装配：没有管理连接也没有 reader 时拒绝；停下时关掉数据面连接', async () => {
    expect(() => createDataControlModule({ ledger: { get: async () => undefined, listLive: async () => [], changesSince: async () => [], latestChange: async () => 0, observe: async () => ({ status: 'unowned' as const }) } })).toThrow('adminUrl');
    const other = manualDataPlane();
    const idle = createDataControlModule({ reader: other.reader, ledger: { get: async () => undefined, listLive: async () => [], changesSince: async () => [], latestChange: async () => 0, observe: async () => ({ status: 'unowned' as const }) } });
    expect(idle.api.name).toBe('data-control');
    idle.observer.start();
    await idle.observer.stop();
    expect(other.closed()).toBe(true);
  });
});
