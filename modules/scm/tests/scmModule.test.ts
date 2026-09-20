import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS, RepositoryBindingDtoSchema, TagDtoSchema } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { notFound } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { hashToken } from '../domain/sessionCredential';
import type { ScmModule } from '../wiring';
import { createScmModule, scmMigrations } from '../wiring';
import { TEST_SETTINGS, fakeGit, fakeGitLab, fakeScratch, fakeTemplates, mutableClock } from './fakeAdapters';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let scm: ScmModule;
const gitlab = fakeGitLab();
const git = fakeGit(gitlab);
const clock = mutableClock();
const owner: Actor = { userId: '01a0bf5d-8f4b-7f8b-8136-e631380738b0' as UserId, isAdmin: false };
const stranger = '01a0bf5d-8f4b-7d2c-8398-1524485c437e' as UserId;
const projectId = '01a0bf5d-8f4b-7148-804c-6bd655d243f6' as ProjectId;
const serviceId = '01a0bf5d-8f4b-7f20-83c3-08a8d54951b2' as ServiceId;
const unknownService = '01a0bf5d-8f4b-741c-831e-a6b38d5da205' as ServiceId;
/** 代替 project 模块：只有 owner 是成员；非成员按 project 模块的约定得到 not_found。 */
const project = {
  isAdmin: async () => false,
  authorize: async (actor: Actor, id: ProjectId) => {
    if (actor.userId !== owner.userId) throw notFound('项目', id);
    return 'owner' as const;
  },
};

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([scmMigrations]);
  scm = createScmModule({
    db: tdb.db, project, settings: TEST_SETTINGS, clock,
    overrides: { gitlab: gitlab.gateway, git: git.runner, templates: fakeTemplates().source, scratch: fakeScratch().dirs },
  });
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('scm module', () => {
  test('迁移建出 scm schema 的业务表与身份映射表；建仓后绑定落库、可读回且幂等', async () => {
    const tables = (await tdb.db.execute(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'scm' ORDER BY table_name`)) as unknown as Array<{ table_name: string }>;
    expect(tables.map((t) => t.table_name)).toEqual(['repository_bindings', 'resource_identity_aliases', 'session_credentials']);
    const dto = await scm.api.ensureRepository(serviceId, projectId, { slug: 'demo', templateId: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });
    expect(RepositoryBindingDtoSchema.parse(dto)).toMatchObject({ state: 'ready', pathWithNamespace: 'crewstation/demo', remoteProjectId: '100' });
    expect(await scm.api.getBinding(owner, serviceId)).toEqual(dto);
    expect(await scm.api.ensureRepository(serviceId, projectId, { slug: 'demo', templateId: '01a0bf5d-8f4b-7002-9560-94caf593fb19' })).toEqual(dto);
    const rows = (await tdb.db.execute(`SELECT service_id, project_id, state, path_with_namespace, message FROM scm.repository_bindings`)) as unknown as Array<Record<string, unknown>>;
    expect(rows).toEqual([{ service_id: serviceId, project_id: projectId, state: 'ready', path_with_namespace: 'crewstation/demo', message: null }]);
    await expect(scm.api.ensureRepository('01a0bf5d-8f4b-76be-8473-58312e41bdd7' as ServiceId, projectId, { slug: 'demo', templateId: '01a0bf5d-8f4b-7002-9560-94caf593fb19' })).rejects.toMatchObject({ kind: 'conflict' });
  });

  test('凭据：库里只有哈希；到期后撤销并写 revoked_at', async () => {
    const issued = await scm.api.issueSessionCredential(serviceId, 15);
    const rows = (await tdb.db.execute(`SELECT id, service_id, token_hash, remote_token_id, revoked_at FROM scm.session_credentials`)) as unknown as Array<{ id: string; service_id: string; token_hash: string; remote_token_id: string; revoked_at: Date | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ service_id: serviceId, token_hash: hashToken(issued.token), remote_token_id: '1', revoked_at: null });
    expect(JSON.stringify(rows)).not.toContain(issued.token);
    expect(await scm.api.revokeExpiredCredentials()).toBe(0);
    clock.advanceMinutes(16);
    expect(await scm.api.revokeExpiredCredentials()).toBe(1);
    const after = (await tdb.db.execute(`SELECT revoked_at FROM scm.session_credentials`)) as unknown as Array<{ revoked_at: Date | null }>;
    expect(after[0]?.revoked_at).not.toBeNull();
    expect(gitlab.get('100').tokens.get('1')?.revoked).toBe(true);
    expect(await scm.api.revokeExpiredCredentials()).toBe(0);
  });

  test('HTTP：仓库、分支（含落后数与查询校验）、标签；未登录 401；非成员 404；未知服务 404', async () => {
    const app = createApp({ name: 'test' });
    for (const router of scm.http) app.route('/', router);
    const asUser = (id: UserId) => ({ [IDENTITY_HEADERS.userId]: id });
    const repo = await app.request(`/v1/services/${serviceId}/repository`, { headers: asUser(owner.userId) });
    expect(repo.status).toBe(200);
    expect(RepositoryBindingDtoSchema.parse(await repo.json()).state).toBe('ready');
    const mainSha = gitlab.get('100').branches.get('main')?.headSha ?? '';
    const previewSha = 'c'.repeat(40);
    gitlab.behind.set(`${mainSha}..${previewSha}`, 2);
    const branches = await app.request(`/v1/services/${serviceId}/branches?previewSha=${previewSha}`, { headers: asUser(owner.userId) });
    expect(await branches.json()).toEqual({ items: [{ name: 'main', headSha: mainSha, isDefault: true, behindPreview: 2, behindProd: null }] });
    expect((await app.request(`/v1/services/${serviceId}/branches?previewSha=not-a-sha`, { headers: asUser(owner.userId) })).status).toBe(400);
    await scm.api.createReleaseTag(serviceId, { branch: 'main', bump: 'minor' });
    const tags = (await (await app.request(`/v1/services/${serviceId}/tags`, { headers: asUser(owner.userId) })).json()) as { items: unknown[] };
    expect(tags.items.map((t) => TagDtoSchema.parse(t))).toEqual([{ name: 'v0.1.0', commitSha: mainSha, createdAt: '2026-09-11T00:00:00.000Z', protected: true }]);
    expect((await app.request(`/v1/services/${serviceId}/repository`)).status).toBe(401);
    expect((await app.request(`/v1/services/${serviceId}/repository`, { headers: asUser(stranger) })).status).toBe(404);
    expect((await app.request(`/v1/services/${unknownService}/repository`, { headers: asUser(owner.userId) })).status).toBe(404);
    expect((await app.request('/v1/services/not-an-id/repository', { headers: asUser(owner.userId) })).status).toBe(400);
  });
});
