import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { generateSecretKey } from '@crewstation/secretbox';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { DataPlaneObject } from '../domain/dataPlane';
import type { DataPlaneReader, DataPlaneWriter } from '../ports/dataPlane';
import { createDataControlModule, dataControlMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const PROJECT = '01a0bf5d-8f4b-7c01-8e19-e226732a75e1' as ProjectId;

/** 手动拨的数据面：用例决定库与角色在不在；调和器删角色时照 OID 从表里拿掉并记下。 */
function manualDataPlane() {
  const databases = new Map<string, DataPlaneObject>(), roles = new Map<string, DataPlaneObject>();
  const drops: string[] = [], ensured: string[] = [];
  let snapshots = 0, closed = false, oid = 18000;
  const plane: DataPlaneReader & DataPlaneWriter = {
    snapshot: async () => { snapshots += 1; return { databases: new Map(databases), roles: new Map(roles), observedAt: new Date().toISOString() }; },
    dropRole: async ({ role, oid, database, reassignTo }) => {
      const live = roles.get(role);
      if (!live) return 'absent';
      if (oid && live.oid !== oid) return 'replaced';
      drops.push(`${role}@${database}→${reassignTo}`);
      roles.delete(role);
      return 'dropped';
    },
    // 建库（I28）：记下口令，角色与库不在才放进表（OID 递增）。
    ensureDatabase: async ({ database, role, password }) => {
      ensured.push(`${database}:${role}:${password}`);
      if (!roles.has(role)) roles.set(role, { name: role, oid: String(oid += 1) });
      if (!databases.has(database)) databases.set(database, { name: database, oid: String(oid += 1) });
    },
    close: async () => { closed = true; },
  };
  return { plane, databases, roles, drops, ensured, snapshots: () => snapshots, closed: () => closed };
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
  const warnings: string[] = [];
  let control: ReturnType<typeof createDataControlModule>;

  beforeAll(async () => {
    database = await createTestDatabase([resourcesMigrations, dataControlMigrations]);
    resources = createResourcesModule({ db: database.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => false });
    control = createDataControlModule({
      plane: plane.plane, logger: { ...noopLogger, warn: (msg: string) => { warnings.push(msg); } }, observer: { pollMs: 20, resyncMs: 60 }, db: database.db, secretKeyBase64: generateSecretKey(),
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

  test('访问绑定：批准生效、临时角色在即运行中；角色过了 VALID UNTIL 记 Expired；受理释放后调和器删掉角色（对象转给运行角色），记录已结束', async () => {
    const role = 'cs_t_0123456789abcdef';
    const data = resources.api.owner('data');
    const spec = { children: [{ kind: 'PostgresRole', name: role }], mode: 'diagnostic-readonly', database: 'cs_shop', ownerRole: 'cs_shop' };
    const binding = await data.declare({ kind: 'data-binding', ref: 'binding-1', projectId: PROJECT, spec, conditions: [{ type: 'Prepared', status: 'true' }, { type: 'Granted', status: 'true' }] });
    await until('角色还没建出来：分配中', async () => (await resources.api.get(binding.id))?.phase === 'provisioning');
    plane.roles.set(role, { name: role, oid: '17001', validUntil: new Date(Date.now() + 3_600_000).toISOString() });
    await until('绑定运行中', async () => (await resources.api.get(binding.id))?.phase === 'ready');
    plane.roles.set(role, { name: role, oid: '17001', validUntil: new Date(Date.now() - 1_000).toISOString() });
    await until('角色记 Expired', async () => (await resources.api.get(binding.id))?.children[0]?.phase === 'Expired');
    await data.requestRelease(binding.id, { code: 'expired', message: '已到期' });
    await until('调和器删掉角色：已结束', async () => (await resources.api.get(binding.id))?.phase === 'stopped');
    expect(plane.drops).toEqual([`${role}@cs_shop→cs_shop`]);
    expect(plane.roles.has(role)).toBe(false);
    expect(control.stats()).toMatchObject({ removed: 1 });
    expect(plane.snapshots()).toBeGreaterThan(0);
  });

  test('第一步投影的旧绑定（期望里没写所在的库）：不删，记一条告警，等 data 自己删；运行角色的名字一律不删', async () => {
    const data = resources.api.owner('data');
    plane.roles.set('cs_t_legacy01', { name: 'cs_t_legacy01', oid: '17101' });
    const legacy = await data.declare({ kind: 'data-binding', ref: 'binding-legacy', projectId: PROJECT, spec: { children: [{ kind: 'PostgresRole', name: 'cs_t_legacy01' }], mode: 'production-change' }, conditions: [{ type: 'Granted', status: 'true' }] });
    await until('旧绑定运行中', async () => (await resources.api.get(legacy.id))?.phase === 'ready');
    await data.requestRelease(legacy.id, { code: 'revoked', message: '已收回' });
    await until('跳过删除并告警', () => warnings.includes('data role removal skipped'));
    expect((await resources.api.get(legacy.id))?.phase).toBe('stopping');
    expect(plane.drops.some((entry) => entry.startsWith('cs_t_legacy01'))).toBe(false);
    plane.roles.delete('cs_t_legacy01');
    await until('data 删掉后已结束', async () => (await resources.api.get(legacy.id))?.phase === 'stopped');
  });

  // RFC-025 I28：标明由 data-control 建的库，它生成口令、加密存自己的表，再建运行角色与库；台账里没有口令。
  test('由 data-control 建的库：口令先存再建，当场补观测、记录运行中；credentialOf 给明文，表里只有密文；已在的不再建、不换口令；旧库不建', async () => {
    const data = resources.api.owner('data');
    const spec = (name: string, provision?: string) => ({ children: [{ kind: 'PostgresDatabase', name }, { kind: 'PostgresRole', name }], engine: 'postgres', ...(provision ? { provision } : {}) });
    const record = await data.declare({ kind: 'database', ref: 'db-new', projectId: PROJECT, spec: spec('cs_new', 'data-control') });
    await until('建出并运行中', async () => (await resources.api.get(record.id))?.phase === 'ready');
    const credential = (await control.api.credentialOf(record.id))!, password = credential.password;
    expect(credential.role).toBe('cs_new');
    expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/);
    // 尾随与全量两条节奏可能各建一次：都用存下的同一个口令（重复执行结果不变）。
    expect(new Set(plane.ensured)).toEqual(new Set([`cs_new:cs_new:${password}`]));
    expect(JSON.stringify(await resources.api.get(record.id))).not.toContain(password);
    const [row] = await database.db.execute(`SELECT secret_box FROM data_control.credentials WHERE resource_id = '${record.id}'`) as unknown as Array<{ secret_box: string }>;
    expect(row!.secret_box).not.toContain(password);
    expect(control.stats().provisioned).toBeGreaterThanOrEqual(1);
    // 库被人删了：再建一次，用的还是存着的那个口令。
    const before = plane.ensured.length;
    plane.databases.delete('cs_new');
    await until('重建库', () => plane.ensured.length > before && plane.databases.has('cs_new'));
    expect(new Set(plane.ensured)).toEqual(new Set([`cs_new:cs_new:${password}`]));
    // 没标明由 data-control 建的旧库：不在也不建；没存过口令的记录 credentialOf 给 undefined。
    const legacy = await data.declare({ kind: 'database', ref: 'db-legacy', projectId: PROJECT, spec: spec('cs_legacy') });
    await until('旧库核对过', async () => (await resources.api.get(legacy.id))?.phase === 'provisioning');
    await Bun.sleep(100);
    expect(plane.ensured.some((entry) => entry.startsWith('cs_legacy'))).toBe(false);
    expect(await control.api.credentialOf(legacy.id)).toBeUndefined();
  });

  test('装配：没有管理连接也没有 reader 时拒绝；停下时关掉数据面连接', async () => {
    expect(() => createDataControlModule({ ledger: { get: async () => undefined, listLive: async () => [], changesSince: async () => [], latestChange: async () => 0, observe: async () => ({ status: 'unowned' as const }) } })).toThrow('adminUrl');
    const other = manualDataPlane();
    const idle = createDataControlModule({ plane: other.plane, ledger: { get: async () => undefined, listLive: async () => [], changesSince: async () => [], latestChange: async () => 0, observe: async () => ({ status: 'unowned' as const }) } });
    expect(idle.api.name).toBe('data-control');
    // 没给平台库与密钥：只观测、不建库，credentialOf 一律没有。
    expect(await idle.api.credentialOf('any')).toBeUndefined();
    idle.observer.start();
    await idle.observer.stop();
    expect(other.closed()).toBe(true);
  });
});
