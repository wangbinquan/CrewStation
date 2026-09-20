import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProfileTestId, ProjectComputePolicy, ProjectId, UserId } from '@crewstation/contracts';
import { CreateComputeProfileRequestSchema, IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { forbidden, newResourceId, notFound } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { queueMigrations } from '@crewstation/queue';
import { generateSecretKey } from '@crewstation/secretbox';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { agentRuntimeMigrations, createAgentRuntimeModule } from '../wiring';
import type { AgentRuntimeModule } from '../wiring';

const profileIds = new Map<string, string>();
const profileId = (name: string) => { if (!profileIds.has(name)) profileIds.set(name, newResourceId()); return profileIds.get(name)!; };
const selector = (name: string) => name === 'default' ? { kind: 'default' as const } : { kind: 'profile' as const, profileId: profileId(name) };
const taskProfiles = { medium: newResourceId(), large: newResourceId(), missing: newResourceId() };
const available = await testDatabaseAvailable();
const admin: Actor = { userId: '01a0bf5d-8f4b-7f8b-8136-e631380738b0' as UserId, isAdmin: true };
const member: Actor = { userId: '01a0bf5d-8f4b-7d2c-8398-1524485c437e' as UserId, isAdmin: false };
const project = (n: number) => `01a0bf5d-8f4b-7000-8000-${String(n).repeat(12)}` as ProjectId;
const inherited: ProjectComputePolicy = { mode: 'inherit', allowedProfiles: [], defaultProfile: null, devTaskProfile: null };
const restricted: ProjectComputePolicy = { mode: 'restricted', allowedProfiles: [profileId('private')], defaultProfile: profileId('private'), devTaskProfile: taskProfiles.large };
const layout = { pullBase: 'registry.test:5000', pushHost: 'registry.test', baseRepository: 'crewstation/task-runtime', runtimePrefix: 'runtime/' };
let db: TestDatabase, mod: AgentRuntimeModule;
const headers = (actor: Actor) => ({ [IDENTITY_HEADERS.userId]: actor.userId, [IDENTITY_HEADERS.userName]: 'tester', [IDENTITY_HEADERS.userEmail]: 'test@example.test', 'content-type': 'application/json' });
const app = () => { const a = createApp({ name: 'project-compute' }); for (const router of mod.http) a.route('/', router); return a; };

beforeAll(async () => {
  if (!available) return;
  db = await createTestDatabase([queueMigrations, agentRuntimeMigrations]);
  mod = createAgentRuntimeModule({ db: db.db, isAdmin: async (id) => id === admin.userId,
    projects: { name: async (id) => [1, 2, 3, 4, 5].some((n) => project(n) === id) ? `project-${[1, 2, 3, 4, 5].find((n) => project(n) === id)}` : undefined,
      authorize: async (actor, id) => { if (![1, 2, 3, 4, 5].some((n) => project(n) === id)) throw notFound('项目', id); if (!actor.isAdmin && id !== project(1)) throw forbidden('无权查看项目'); } },
    settings: { defaultTaskProfile: taskProfiles.medium, secretKeyBase64: generateSecretKey(), registry: { ...layout, scheme: 'http', baseTag: 'dev' } },
    registry: { layout, resolveDigest: async () => `sha256:${'1'.repeat(64)}` },
    executor: { run: async () => ({ state: 'passed', outcome: 'passed', stages: [] }) },
    references: { listReferencingProjects: async () => [] }, taskProfiles: { exists: async (name) => [taskProfiles.medium, taskProfiles.large].includes(name) },
  });
  for (const name of ['public', 'private', 'terminal']) {
    const protocol = name === 'terminal' ? 'terminal' : 'opencode';
    const detail = await mod.api.createProfile(admin, CreateComputeProfileRequestSchema.parse({ name, defaultVisible: name !== 'private',
      content: { image: 'runtime/agent:v1', launch: { protocol, binaryPath: '/opt/agent' }, ...(protocol === 'terminal' ? { terminalTest: { command: ['/opt/agent', '--version'], expect: 'agent' } } : {}) } }));
    profileIds.set(name, detail.id);
    await mod.api.runQueuedTest(detail.latestTest!.testId as ProfileTestId, async () => true);
  }
  restricted.allowedProfiles = [profileId('private')]; restricted.defaultProfile = profileId('private');
  await mod.api.setDefault(admin, profileId('public'));
});
afterAll(async () => { await db?.drop(); });

describe.skipIf(!available)('项目算力分配与档位可见性（RFC-012）', () => {
  test('未配置项目只继承默认可见档位；直接点名隐藏档位的三类启动和发布均拒绝', async () => {
    expect(await mod.api.getProjectComputePolicy(member, project(1))).toMatchObject({ revision: 0, policy: inherited, effectiveDefaultProfile: profileId('public'), effectiveDevTaskProfile: taskProfiles.medium });
    expect((await mod.api.listProjectSummaries(member, project(1))).map((p) => p.name)).toEqual(['public', 'terminal']);
    expect((await mod.api.listSummaries()).map((p) => p.name)).not.toContain('private');
    expect(await mod.api.resolveForProject(project(1), undefined, 'agent')).toMatchObject({ name: 'public', revision: 1 });
    for (const usage of ['agent', 'cli', 'subtask'] as const) await expect(mod.api.resolveForProject(project(1), selector('private'), usage)).rejects.toMatchObject({ kind: 'forbidden', details: { code: 'project_compute_forbidden' } });
    await expect(mod.api.lookupForProjectRelease(project(1), selector('private'))).rejects.toMatchObject({ kind: 'forbidden' });
  });

  test('单独授予隐藏档位后 default 解析为项目默认；撤销只影响未来启动，已固定的修订仍可取材料', async () => {
    expect(await mod.api.saveProjectComputePolicy(admin, project(2), { expectedRevision: 0, policy: restricted })).toMatchObject({ revision: 1, effectiveDefaultProfile: profileId('private'), effectiveDevTaskProfile: taskProfiles.large });
    expect(await mod.api.listProjectSummaries(admin, project(2))).toEqual([expect.objectContaining({ name: 'private', isDefault: true })]);
    expect(await mod.api.resolveForProject(project(2), selector('default'), 'subtask')).toMatchObject({ name: 'private', revision: 1 });
    expect(await mod.api.lookupForProjectRelease(project(2), selector('default'))).toEqual({ id: profileId('private'), name: 'private', terminalOnly: false });
    expect(await mod.api.projectDevTaskProfile(project(2))).toBe(taskProfiles.large);
    await expect(mod.api.resolveForProject(project(2), selector('public'), 'cli')).rejects.toMatchObject({ kind: 'forbidden' });
    expect((await mod.api.getProfile(admin, profileId('private'))).referencedBy).toContain('project-2');
    await expect(mod.api.removeProfile(admin, profileId('private'), false)).rejects.toMatchObject({ kind: 'conflict', details: { projects: ['project-2'] } });
    await mod.api.saveProjectComputePolicy(admin, project(2), { expectedRevision: 1, policy: { ...restricted, allowedProfiles: [], defaultProfile: null } });
    expect(await mod.api.listProjectSummaries(admin, project(2))).toEqual([]);
    await expect(mod.api.resolveForProject(project(2), undefined, 'agent')).rejects.toMatchObject({ details: { code: 'no_project_default_profile' } });
    await expect(mod.api.resolveForProject(project(2), selector('private'), 'agent')).rejects.toMatchObject({ kind: 'forbidden' });
    expect(await mod.api.launchMaterial({ profileId: profileId('private'), revision: 1 })).toMatchObject({ revision: 1 });
  });

  test('项目显式清单支持无默认和仅终端；未知档位、套餐、终端默认与非管理员写入被拒绝', async () => {
    const save = (policy: ProjectComputePolicy) => mod.api.saveProjectComputePolicy(admin, project(3), { expectedRevision: 0, policy });
    await expect(save({ ...restricted, allowedProfiles: [profileId('missing')], defaultProfile: profileId('missing') })).rejects.toMatchObject({ kind: 'validation', details: { field: 'allowedProfiles' } });
    await expect(save({ ...restricted, allowedProfiles: [profileId('terminal')], defaultProfile: profileId('terminal') })).rejects.toMatchObject({ kind: 'validation', details: { field: 'defaultProfile' } });
    await expect(save({ ...restricted, devTaskProfile: taskProfiles.missing })).rejects.toMatchObject({ kind: 'validation', details: { field: 'devTaskProfile' } });
    await expect(mod.api.saveProjectComputePolicy(member, project(1), { expectedRevision: 0, policy: inherited })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(mod.api.listProjectSummaries(member, project(2))).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(mod.api.resolveForProject(project(9), selector('public'), 'agent')).rejects.toMatchObject({ kind: 'not_found' });
    await expect(mod.api.projectDevTaskProfile(project(9))).rejects.toMatchObject({ kind: 'not_found' });
    await save({ ...restricted, allowedProfiles: [profileId('terminal')], defaultProfile: null });
    expect(await mod.api.resolveForProject(project(3), selector('terminal'), 'cli')).toMatchObject({ protocol: 'terminal' });
    await expect(mod.api.resolveForProject(project(3), selector('terminal'), 'agent')).rejects.toMatchObject({ kind: 'validation' });
  });

  test('创建和更新均比较授权版本；同时保存只有一个成功，恢复继承使用当前平台默认', async () => {
    for (const revision of [0, 1]) {
      const results = await Promise.allSettled([inherited, restricted].map((policy) => mod.api.saveProjectComputePolicy(admin, project(4), { expectedRevision: revision, policy })));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { kind: 'conflict', details: { code: 'project_compute_revision_conflict' } } });
    }
    await mod.api.saveProjectComputePolicy(admin, project(4), { expectedRevision: 2, policy: inherited });
    expect(await mod.api.projectDevTaskProfile(project(4))).toBeUndefined();
    expect(await mod.api.resolveForProject(project(4), selector('default'), 'agent')).toMatchObject({ name: 'public' });
  });

  test('平台默认不能隐藏；把隐藏档位设为默认自动可见，不追加执行修订', async () => {
    await expect(mod.api.setDefaultVisible(admin, profileId('public'), false)).rejects.toMatchObject({ kind: 'conflict', details: { code: 'default_profile_visible' } });
    await expect(mod.api.setDefaultVisible(member, profileId('private'), true)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(mod.api.setDefaultVisible(admin, profileId('missing'), true)).rejects.toMatchObject({ kind: 'not_found' });
    expect(await mod.api.setDefault(admin, profileId('private'))).toMatchObject({ defaultVisible: true, isDefault: true, revision: 1 });
    expect(await mod.api.resolveForProject(project(1), selector('default'), 'agent')).toMatchObject({ name: 'private' });
    await mod.api.setDefault(admin, profileId('public'));
    expect(await mod.api.setDefaultVisible(admin, profileId('private'), false)).toMatchObject({ defaultVisible: false, revision: 1 });
  });

  test('HTTP：成员只读本项目，未登录 401，管理员保存成功、校验 400、旧版本 409；响应禁止缓存', async () => {
    const a = app(), url = `/v1/projects/${project(1)}/compute-policy`;
    expect((await a.request(url)).status).toBe(401);
    expect((await a.request(`/v1/projects/${project(2)}/compute-profiles`, { headers: headers(member) })).status).toBe(403);
    const read = await a.request(url, { headers: headers(member) });
    expect(read.status).toBe(200); expect(read.headers.get('cache-control')).toBe('no-store');
    const write = (actor: Actor, body: unknown) => a.request(url, { method: 'PUT', headers: headers(actor), body: JSON.stringify(body) });
    expect((await write(member, { expectedRevision: 0, policy: restricted })).status).toBe(403);
    expect((await write(admin, { expectedRevision: 0, policy: { ...restricted, defaultProfile: profileId('public') } })).status).toBe(400);
    expect((await write(admin, { expectedRevision: 0, policy: restricted })).status).toBe(200);
    expect((await write(admin, { expectedRevision: 0, policy: inherited })).status).toBe(409);
    const catalog = await a.request(`/v1/projects/${project(1)}/compute-profiles`, { headers: headers(member) });
    expect(catalog.status).toBe(200); expect(await catalog.json()).toMatchObject({ items: [{ name: 'private', isDefault: true }] });
    expect((await a.request(`/v1/admin/compute-profiles/${profileId('private')}/default-visible`, { method: 'PUT', headers: headers(admin), body: JSON.stringify({ defaultVisible: true }) })).status).toBe(200);
    expect((await a.request(`/v1/admin/compute-profiles/${profileId('public')}/default-visible`, { method: 'PUT', headers: headers(admin), body: JSON.stringify({ defaultVisible: false }) })).status).toBe(409);
  });

  test('升级旧库保留全部档位默认可见，数据库本身拒绝隐藏平台默认', async () => {
    const old = await createTestDatabase([{ ...agentRuntimeMigrations, files: agentRuntimeMigrations.files.filter((f) => f.name < '0004') }]);
    try {
      await old.db.execute(sql`INSERT INTO agent_runtime.profiles (name, protocol, description, enabled, is_default, current_revision, created_by, updated_by, created_at, updated_at) VALUES ('old-default', 'opencode', '', true, true, 1, 'admin', 'admin', now(), now())`);
      await runMigrations(old.db, [{ ...agentRuntimeMigrations, files: agentRuntimeMigrations.files.filter((f) => f.name < '0005') }]);
      expect(await old.db.execute(sql`SELECT default_visible FROM agent_runtime.profiles`)).toEqual([expect.objectContaining({ default_visible: true })]);
      await expect(Promise.resolve(old.db.execute(sql`UPDATE agent_runtime.profiles SET default_visible = false WHERE name = 'old-default'`))).rejects.toBeDefined();
    } finally { await old.drop(); }
  });
});
