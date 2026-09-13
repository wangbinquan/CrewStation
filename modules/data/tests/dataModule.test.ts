import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import type { Actor, ProjectId, ServiceId, TaskId, UserId } from '@crewstation/contracts';
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
const serviceId = 'svc_0123456789abcdef0123456789abcdef' as ServiceId;
const projectId = 'prj_0123456789abcdef0123456789abcdef' as ProjectId;
const taskId = 'tsk_0123456789abcdef0123456789abcdef' as TaskId;
const owner: Actor = { userId: 'usr_0123456789abcdef0123456789abcdef' as UserId, isAdmin: false };
const dev: Actor = { userId: 'usr_1123456789abcdef0123456789abcdef' as UserId, isAdmin: false };

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([dataMigrations]);
  const url = new URL(adminUrl);
  data = createDataModule({
    db: tdb.db,
    authorizer: { authorize: async (actor, _p, action) => { if (action === 'approve-data-access' && actor.userId !== owner.userId) throw new Error('forbidden'); } },
    services: { resolveServiceById: async () => ({ projectId, slug }) },
    isAdmin: async () => false,
    settings: { defaultPlan: 'db-small', secretKeyBase64: generateSecretKey(), postgres: { adminUrl, visibleHost: url.hostname, visiblePort: Number(url.port) } },
  });
});
afterAll(async () => {
  if (!available) return;
  const admin = new SQL(adminUrl, { max: 1 });
  for (const db of [`cs_${slug}`, `cs_${slug}_dev`]) await admin.unsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
  const roles = (await admin`SELECT rolname FROM pg_roles WHERE rolname LIKE ${`cs_${slug}%`}`) as Array<{ rolname: string }>;
  for (const r of roles) await admin.unsafe(`DROP ROLE "${r.rolname}"`);
  await admin.close();
  await tdb?.drop();
});

const canQuery = async (dsn: string, sql: string): Promise<boolean> => {
  const client = new SQL(dsn, { max: 1 });
  try { await client.unsafe(sql); return true; } catch { return false; } finally { await client.close(); }
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
    expect(await data.api.listProjectBindings(owner, projectId, ['requested'])).toHaveLength(1);
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
});
