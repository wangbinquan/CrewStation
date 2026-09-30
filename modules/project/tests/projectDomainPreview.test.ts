import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { createProjectModule, projectMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let db: TestDatabase;
beforeAll(async () => { if (available) db = await createTestDatabase([eventbusMigrations, identityMigrations, projectMigrations]); });
afterAll(async () => { await db?.drop(); });

describe.skipIf(!available)('创建域名预览 HTTP', () => {
  test('真实成功路径与创建后的服务一致，查询不产生项目或 outbox 写入', async () => {
    const identity = createIdentityModule({ db: db.db, settings: { adminEmails: [] } });
    const admin = await identity.api.ensureUser({ externalId: 'domain-admin', name: 'Admin', email: 'domain-admin@example.cn' });
    const member = await identity.api.ensureUser({ externalId: 'domain-user', name: 'User', email: 'domain-user@example.cn' });
    const project = createProjectModule({ db: db.db, identity: identity.api,
      hosts: { prodHost: (s) => `${s}.installed.example.cn`, previewHost: (s) => `preview.${s}.installed.example.cn`, serviceHost: (s) => `${s}.svc.internal` },
      settings: { defaultServicePlan: BUILTIN_RESOURCES.servicePlanSmall, defaultMaxConcurrentTasks: 3 } });
    const app = createApp({ name: 'domain-preview' }); for (const route of project.http) app.route('/', route);
    const headers = { [IDENTITY_HEADERS.userId]: admin.id };
    const response = await app.request('/v1/catalog/project-domain-preview?slug=weekly-report', { headers });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toEqual({ slug: 'weekly-report', prodHost: 'weekly-report.installed.example.cn', previewHost: 'preview.weekly-report.installed.example.cn', serviceHost: 'weekly-report.svc.internal' });
    expect(await db.db.execute('SELECT id FROM project.projects')).toHaveLength(0);
    expect(await db.db.execute('SELECT id FROM platform_infra.domain_events')).toHaveLength(0);
    for (const slug of ['console', 'BAD', '']) expect((await app.request(`/v1/catalog/project-domain-preview?slug=${slug}`, { headers })).status).toBe(400);
    expect((await app.request('/v1/catalog/project-domain-preview?slug=weekly-report')).status).toBe(401);
    expect((await app.request('/v1/catalog/project-domain-preview?slug=weekly-report', { headers: { [IDENTITY_HEADERS.userId]: member.id } })).status).toBe(403);
    const actor = { userId: admin.id, isAdmin: true };
    await project.api.updateServicePlan(actor, BUILTIN_RESOURCES.servicePlanSmall, { name: 'default', cpu: '1', memory: '1Gi', maxReplicas: 1, description: '' });
    const created = await project.api.createProject(actor, { slug: 'weekly-report', name: 'Weekly', kind: 'DigitalWorker', template: BUILTIN_RESOURCES.minimalTemplate });
    expect(await project.api.getService(actor, created.serviceId!)).toMatchObject({ prodHost: result.prodHost, previewHost: result.previewHost, serviceHost: result.serviceHost });
  });
});
