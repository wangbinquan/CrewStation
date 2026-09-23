import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import type { Actor, ProjectId, ServiceId, TaskId, UserId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { eventbusMigrations, publishDomainEvent } from '@crewstation/eventbus';
import { generateSecretKey } from '@crewstation/secretbox';
import type { TestDatabase } from '@crewstation/testkit';
import { DEFAULT_TEST_DATABASE_URL, createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { DataModule } from '../wiring';
import { createDataModule, dataMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const adminUrl = process.env.CS_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
let tdb: TestDatabase;
let data: DataModule;
const suffix = Bun.randomUUIDv7().replace(/-/g, '').slice(0, 8);
const slug = `t${suffix}`;
const serviceId = '01a0bf5d-8f4b-76c5-866c-f1feda3d63bb' as ServiceId;
const projectId = '01a0bf5d-8f4b-7178-82e1-9a99060b1192' as ProjectId;
const taskId = '01a0bf5d-8f4b-7418-8a3f-7cbb4a1fd751' as TaskId;
const owner: Actor = { userId: '01a0bf5d-8f4b-7793-867c-efd7527b386b' as UserId, isAdmin: false };
const dev: Actor = { userId: '01a0bf5d-8f4b-7a4e-8eb2-04fca5c047bf' as UserId, isAdmin: false };

type DataDeps = Parameters<typeof createDataModule>[0];
let deps: Omit<DataDeps, 'db'>;
beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, dataMigrations]);
  const url = new URL(adminUrl);
  deps = {
    users: { displayName: async (id) => id === dev.userId ? '开发者小李' : id === owner.userId ? '负责人小周' : undefined },
    authorizer: { authorize: async (actor, _p, action) => { if (action === 'approve-data-access' && actor.userId !== owner.userId) throw new Error('forbidden'); } },
    services: { resolveServiceById: async () => ({ projectId, slug }) },
    isAdmin: async () => false,
    settings: { defaultPlan: 'db-small', secretKeyBase64: generateSecretKey(), postgres: { adminUrl, visibleHost: url.hostname, visiblePort: Number(url.port) } },
  };
  data = createDataModule({ ...deps, db: tdb.db });
});
afterAll(async () => {
  if (!available) return;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  for (const db of [`cs_${slug}`, `cs_${slug}_dev`]) await admin.unsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
  const roles = (await admin`SELECT rolname FROM pg_roles WHERE rolname LIKE ${`cs_${slug}%`}`) as Array<{ rolname: string }>;
  for (const r of roles) await admin.unsafe(`DROP ROLE "${r.rolname}"`);
  await admin.end();
  await tdb?.drop();
});

const canQuery = async (dsn: string, sql: string): Promise<boolean> => {
  const client = postgres(dsn, { max: 1, onnotice: () => undefined });
  try { await client.unsafe(sql); return true; } catch { return false; } finally { await client.end(); }
};

describe.skipIf(!available)('data module', () => {
  test('供给生产库与开发库：幂等、连接串加密、PUBLIC 不能连接', async () => {
    const first = await data.api.ensureServiceData(serviceId);
    expect(first.map((r) => [r.env, r.state, r.envVar])).toEqual([['production', 'ready', 'CS_DATABASE_URL'], ['development', 'ready', 'CS_DATABASE_URL']]);
    expect((await data.api.ensureServiceData(serviceId)).length).toBe(2);
    const prod = await data.api.envFor(serviceId, 'production');
    const devEnv = await data.api.envFor(serviceId, 'development');
    expect(prod.CS_DATABASE_URL).toContain(`/cs_${slug}`);
    expect(devEnv.CS_DATABASE_URL).toContain(`/cs_${slug}_dev`);
    expect(await canQuery(prod.CS_DATABASE_URL!, 'CREATE TABLE t (id int)')).toBe(true);
    const crossDsn = devEnv.CS_DATABASE_URL!.replace(`/cs_${slug}_dev`, `/cs_${slug}`);
    expect(await canQuery(crossDsn, 'SELECT 1')).toBe(false);
    const stored = (await tdb.db.execute(`SELECT secret_box FROM data.resources`)) as unknown as Array<{ secret_box: string }>;
    expect(stored.every((r) => r.secret_box.startsWith('v1:'))).toBe(true);
  });

  test('开发模式直接生效；只读诊断需负责人批准且不能写；生产变更可写；撤权后不可用', async () => {
    const devBinding = await data.api.requestTaskBinding(dev, { taskId, serviceId }, { mode: 'development', ttlMinutes: 120 });
    expect(devBinding.state).toBe('active');
    expect((await data.api.envForTask(taskId)).CS_DATABASE_URL).toContain('_dev');

    const ro = await data.api.requestTaskBinding(dev, { taskId, serviceId }, { mode: 'diagnostic-readonly', reason: '看日志表', ttlMinutes: 30 });
    expect(ro.state).toBe('requested');
    expect(ro.ttlMinutes).toBe(30);
    const requestedList = await data.api.listProjectBindings(owner, projectId, ['requested']);
    expect(requestedList).toHaveLength(1); expect(requestedList[0]).toMatchObject({ requestedByName: '开发者小李' });
    await expect(data.api.decideTaskBinding(dev, ro.id, { approve: true })).rejects.toThrow('forbidden');
    const approved = await data.api.decideTaskBinding(owner, ro.id, { approve: true, decision: '同意 30 分钟' });
    expect(approved.state).toBe('active');
    expect(approved.ttlMinutes).toBe(30);
    const env = await data.api.envForTask(taskId);
    expect(await canQuery(env.CS_PROD_READONLY_DATABASE_URL!, 'SELECT count(*) FROM t')).toBe(true);
    expect(await canQuery(env.CS_PROD_READONLY_DATABASE_URL!, 'INSERT INTO t VALUES (1)')).toBe(false);

    const rw = await data.api.requestTaskBinding(dev, { taskId, serviceId }, { mode: 'production-change', ttlMinutes: 10 });
    const rejected = await data.api.decideTaskBinding(owner, rw.id, { approve: false, decision: '先走只读' });
    expect(rejected.state).toBe('rejected');
    const rw2 = await data.api.requestTaskBinding(dev, { taskId, serviceId }, { mode: 'production-change', ttlMinutes: 10 });
    await data.api.decideTaskBinding(owner, rw2.id, { approve: true });
    const env2 = await data.api.envForTask(taskId);
    expect(await canQuery(env2.CS_PROD_DATABASE_URL!, 'INSERT INTO t VALUES (2)')).toBe(true);
    await data.api.revokeTaskBinding(owner, rw2.id);
    expect((await data.api.envForTask(taskId)).CS_PROD_DATABASE_URL).toBeUndefined();
    expect(await canQuery(env2.CS_PROD_DATABASE_URL!, 'SELECT 1')).toBe(false);
  });
  test('到期的绑定由后台任务收掉：标成已过期、删掉临时角色（2026-09-23 前 expireBindings 没有接到任何后台任务）', async () => {
    let now = Date.now();
    const expiring = createDataModule({ ...deps, db: tdb.db, clock: { now: () => new Date(now) }, expiryIntervalMs: 20 });
    expect(expiring.workers).toHaveLength(1);
    const requested = await expiring.api.requestTaskBinding(dev, { taskId, serviceId }, { mode: 'diagnostic-readonly', reason: '到期回收', ttlMinutes: 5 });
    await expiring.api.decideTaskBinding(owner, requested.id, { approve: true });
    const role = `cs_t_${requested.id.replaceAll('-', '')}`;
    const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
    const roles = async () => Number((await admin`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = ${role}`)[0]?.n);
    const stateOf = async () => (await expiring.api.listTaskBindings(owner, taskId)).find((b) => b.id === requested.id)?.state;
    try {
      expect(await stateOf()).toBe('active');
      expect(await roles()).toBe(1);
      now += 6 * 60_000;
      expiring.workers[0]!.start();
      for (let i = 0; i < 100 && (await stateOf()) !== 'expired'; i++) await Bun.sleep(20);
      await expiring.workers[0]!.stop();
      expect(await stateOf()).toBe('expired');
      expect(await roles()).toBe(0);
    } finally { await expiring.workers[0]!.stop(); await admin.end(); }
  });
  test('开发会话释放（任务已释放事件）时收回它名下还没结束的绑定：生效中的删掉临时角色，申请中的一并收回，别的任务不受影响；重复投递无副作用（2026-09-23 作者裁定）', async () => {
    const released = '01a0bf5d-8f4b-7418-8a3f-7cbb4a1fd760' as TaskId;
    const active = await data.api.requestTaskBinding(dev, { taskId: released, serviceId }, { mode: 'diagnostic-readonly', reason: '释放即收回', ttlMinutes: 30 });
    await data.api.decideTaskBinding(owner, active.id, { approve: true });
    const pending = await data.api.requestTaskBinding(dev, { taskId: released, serviceId }, { mode: 'production-change', ttlMinutes: 10 });
    const other = await data.api.requestTaskBinding(dev, { taskId, serviceId }, { mode: 'development', ttlMinutes: 120 });
    const role = `cs_t_${active.id.replaceAll('-', '')}`;
    const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
    const roles = async () => Number((await admin`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = ${role}`)[0]?.n);
    const statesOf = async (task: TaskId) => Object.fromEntries((await data.api.listTaskBindings(owner, task)).map((b) => [b.id, b.state]));
    const release = () => publishDomainEvent(tdb.db, DomainTopic.taskReleased, { occurredAt: new Date().toISOString(), projectId, taskId: released, kind: 'dev-session', reason: 'user' });
    try {
      expect(await roles()).toBe(1);
      await release();
      expect(await data.subscriptions[0]!.runOnce()).toBe(1);
      expect(await statesOf(released)).toEqual({ [active.id]: 'revoked', [pending.id]: 'revoked' });
      expect(await roles()).toBe(0);
      expect((await statesOf(taskId))[other.id]).toBe('active');
      await release();
      await data.subscriptions[0]!.runOnce();
      expect(await statesOf(released)).toEqual({ [active.id]: 'revoked', [pending.id]: 'revoked' });
    } finally { await admin.end(); }
  });
});
