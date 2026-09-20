import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createApp } from '@crewstation/http';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { createProjectModule, projectMigrations } from '@crewstation/module-project';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { ConfigModule } from '../wiring';
import { configMigrations, createConfigModule } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let config: ConfigModule;
let admin: Actor;
let owner: Actor;
let dev: Actor;
let projectId: ProjectId;
const stranger: Actor = { userId: 'usr_00000000000000000000000000000000' as UserId, isAdmin: false };
const hosts = { prodHost: (s: string) => `${s}.cs.localhost`, previewHost: (s: string) => `preview.${s}.cs.localhost`, serviceHost: (s: string) => `${s}.svc.cs.internal` };
const secretKeyBase64 = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, identityMigrations, projectMigrations, configMigrations]);
  const identity = createIdentityModule({ db: tdb.db, settings: { adminEmails: [] } });
  const a = await identity.api.ensureUser({ externalId: 'demo:admin', name: 'Admin', email: 'admin@example.com' });
    if (a.platformRole === 'user') await identity.api.setPlatformRole(a.id, { platformRole: 'developer', expectedRole: 'user' });
  const o = await identity.api.ensureUser({ externalId: 'demo:owner', name: 'Owner', email: 'owner@example.com' });
    if (o.platformRole === 'user') await identity.api.setPlatformRole(o.id, { platformRole: 'developer', expectedRole: 'user' });
  const d = await identity.api.ensureUser({ externalId: 'demo:dev', name: 'Dev', email: 'dev@example.com' });
    if (d.platformRole === 'user') await identity.api.setPlatformRole(d.id, { platformRole: 'developer', expectedRole: 'user' });
  admin = { userId: a.id, isAdmin: true };
  owner = { userId: o.id, isAdmin: false };
  dev = { userId: d.id, isAdmin: false };
  const project = createProjectModule({ db: tdb.db, identity: identity.api, hosts, settings: { defaultMaxConcurrentTasks: 3, defaultServicePlan: 'standard-small' } });
  await project.api.upsertServicePlan(admin, { name: 'standard-small', cpu: '500m', memory: '512Mi', maxReplicas: 3, description: '' });
  projectId = (await project.api.createProject(admin, { slug: 'demo', name: '演示', kind: 'DigitalWorker', ownerUserId: owner.userId, template: 'minimal-sample' })).id;
  await project.api.setMember(owner, projectId, { userId: dev.userId, role: 'developer' });
  config = createConfigModule({ db: tdb.db, project: project.api, settings: { secretKeyBase64 } });
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('config module', () => {
  test('负责人维护生产组：版本按取值组递增、Secret 只写不读、密文落库、事件落库', async () => {
    const host = await config.api.setItem(owner, projectId, { name: 'DB_HOST', env: 'production', value: 'db.internal', isSecret: false });
    expect(host).toMatchObject({ name: 'DB_HOST', env: 'production', isSecret: false, value: 'db.internal', version: 1, updatedBy: owner.userId });
    const token = await config.api.setItem(owner, projectId, { name: 'API_TOKEN', env: 'production', value: 's3cret', isSecret: true });
    expect(token.version).toBe(2);
    expect(token.value).toBeUndefined();
    const listed = await config.api.listItems(dev, projectId, 'production');
    expect(listed.map((i) => i.name)).toEqual(['API_TOKEN', 'DB_HOST']);
    expect(listed[0]).not.toHaveProperty('value');
    expect(listed[1]?.value).toBe('db.internal');
    expect(await config.api.currentVersion(projectId, 'production')).toBe(2);
    expect(await config.api.currentVersion(projectId, 'development')).toBe(0);
    const stored = (await tdb.db.execute(`SELECT value FROM config.items WHERE name = 'API_TOKEN'`)) as unknown as Array<{ value: string }>;
    expect(stored[0]?.value.startsWith('v1:')).toBe(true);
    expect(stored[0]?.value).not.toContain('s3cret');
    const snapshots = (await tdb.db.execute(`SELECT value FROM config.version_entries WHERE name = 'API_TOKEN'`)) as unknown as Array<{ value: string }>;
    expect(snapshots.every((row) => !row.value.includes('s3cret'))).toBe(true);
    const rows = (await tdb.db.execute(`SELECT payload FROM platform_infra.domain_events WHERE topic = 'config.changed' ORDER BY id`)) as unknown as Array<{ payload: unknown }>;
    const payloads = rows.map((r) => (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) as { env: string; version: number; projectId: string });
    expect(payloads.map((e) => [e.env, e.version])).toEqual([['production', 1], ['production', 2]]);
    expect(payloads[0]?.projectId).toBe(projectId);
  });

  test('角色表：开发者不能改生产组但能改开发组；非成员 404；名字与项目存在性校验', async () => {
    await expect(config.api.setItem(dev, projectId, { name: 'DB_HOST', env: 'production', value: 'x', isSecret: false })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(config.api.deleteItem(dev, projectId, 'production', 'DB_HOST')).rejects.toMatchObject({ kind: 'forbidden' });
    const debug = await config.api.setItem(dev, projectId, { name: 'DEBUG', env: 'development', value: '1', isSecret: false });
    expect(debug.version).toBe(1);
    expect(await config.api.currentVersion(projectId, 'production')).toBe(2);
    await expect(config.api.setItem(stranger, projectId, { name: 'X', env: 'development', value: '1', isSecret: false })).rejects.toMatchObject({ kind: 'not_found' });
    await expect(config.api.listItems(stranger, projectId, 'development')).rejects.toMatchObject({ kind: 'not_found' });
    await expect(config.api.setItem(owner, projectId, { name: 'bad-name', env: 'production', value: '1', isSecret: false })).rejects.toMatchObject({ kind: 'validation' });
    expect(await config.api.setItem(admin, projectId, { name: 'ADMIN_SET', env: 'production', value: 'a', isSecret: false })).toMatchObject({ version: 3 });
  });

  test('renderEnv 解密并可按版本回放；删除生成新版本；validateManifestEnv 报缺失键', async () => {
    expect(await config.api.renderEnv(projectId, 'production')).toEqual({ ADMIN_SET: 'a', API_TOKEN: 's3cret', DB_HOST: 'db.internal' });
    expect((await config.api.setItem(owner, projectId, { name: 'DB_HOST', env: 'production', value: 'db2.internal', isSecret: false })).version).toBe(4);
    expect((await config.api.renderEnv(projectId, 'production', 2)).DB_HOST).toBe('db.internal');
    expect((await config.api.renderEnv(projectId, 'production', 2)).ADMIN_SET).toBeUndefined();
    expect((await config.api.renderEnv(projectId, 'production')).DB_HOST).toBe('db2.internal');
    await config.api.deleteItem(owner, projectId, 'production', 'DB_HOST');
    expect(await config.api.currentVersion(projectId, 'production')).toBe(5);
    expect(Object.keys(await config.api.renderEnv(projectId, 'production')).sort()).toEqual(['ADMIN_SET', 'API_TOKEN']);
    await expect(config.api.deleteItem(owner, projectId, 'production', 'DB_HOST')).rejects.toMatchObject({ kind: 'not_found' });
    expect(await config.api.currentVersion(projectId, 'production')).toBe(5);
    await expect(config.api.renderEnv(projectId, 'production', 99)).rejects.toMatchObject({ kind: 'not_found' });
    const versions = await config.api.listVersions(dev, projectId, 'production');
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4, 5]);
    expect(versions[4]?.keys).toEqual(['ADMIN_SET', 'API_TOKEN']);
    expect(versions[0]?.keys).toEqual(['DB_HOST']);
    expect(await config.api.validateManifestEnv(projectId, 'production', [
      { name: 'API_TOKEN', from: 'secret' }, { name: 'DB_URL', from: 'config', key: 'DATABASE_URL' }, { name: 'ADMIN_SET', from: 'config' },
    ])).toEqual({ missing: ['DATABASE_URL'] });
    expect(await config.api.validateManifestEnv(projectId, 'development', [{ name: 'DEBUG', from: 'config' }])).toEqual({ missing: [] });
  });

  test('HTTP 路由：身份头进入、env 不一致 400、开发者改生产 403、Secret 不回显、删除 204、未登录 401', async () => {
    const app = createApp({ name: 'test' });
    for (const router of config.http) app.route('/', router);
    const asUser = (id: UserId) => ({ [IDENTITY_HEADERS.userId]: id, 'content-type': 'application/json' });
    const base = `/v1/projects/${projectId}/config/production`;
    const put = await app.request(base, { method: 'PUT', headers: asUser(owner.userId), body: JSON.stringify({ name: 'FEATURE_X', env: 'production', value: 'on' }) });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ name: 'FEATURE_X', value: 'on', version: 6, isSecret: false });
    const mismatch = await app.request(base, { method: 'PUT', headers: asUser(owner.userId), body: JSON.stringify({ name: 'FEATURE_Y', env: 'development', value: 'on' }) });
    expect(mismatch.status).toBe(400);
    const badName = await app.request(base, { method: 'PUT', headers: asUser(owner.userId), body: JSON.stringify({ name: 'lower', env: 'production', value: 'on' }) });
    expect(badName.status).toBe(400);
    const forbidden = await app.request(base, { method: 'PUT', headers: asUser(dev.userId), body: JSON.stringify({ name: 'FEATURE_Z', env: 'production', value: 'on' }) });
    expect(forbidden.status).toBe(403);
    const list = await app.request(base, { headers: asUser(dev.userId) });
    const items = (await list.json() as { items: Array<{ name: string; value?: string }> }).items;
    expect(items.map((i) => i.name)).toEqual(['ADMIN_SET', 'API_TOKEN', 'FEATURE_X']);
    expect(items.find((i) => i.name === 'API_TOKEN')).not.toHaveProperty('value');
    const versions = await app.request(`${base}/versions`, { headers: asUser(dev.userId) });
    expect((await versions.json() as { items: unknown[] }).items).toHaveLength(6);
    expect((await app.request(`${base}/FEATURE_X`, { method: 'DELETE', headers: asUser(owner.userId) })).status).toBe(204);
    expect((await app.request(`${base}/FEATURE_X`, { method: 'DELETE', headers: asUser(owner.userId) })).status).toBe(404);
    expect((await app.request(`/v1/projects/${projectId}/config/staging`, { headers: asUser(owner.userId) })).status).toBe(400);
    expect((await app.request(base)).status).toBe(401);
  });
});
