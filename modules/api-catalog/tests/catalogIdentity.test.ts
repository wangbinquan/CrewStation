import { describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, ReleaseId, ServiceId, UserId } from '@crewstation/contracts';
import { BUILTIN_RESOURCES, ManifestSchema, ResourceIdSchema } from '@crewstation/contracts';
import { systemClock } from '@crewstation/kernel';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { registerReleaseUseCase } from '../application/registerRelease';
import { catalogQueryUseCases } from '../application/queryCatalog';
import { setOpenPolicyUseCase } from '../application/setOpenPolicy';
import { prunedOpenApiUseCase } from '../application/prunedOpenApi';
import { apiCatalogMigrations } from '../wiring';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('API directory UUID identities', () => {
  test('releases, label changes, protocol renaming and removal retain grants and operation IDs', async () => {
    // 改开放策略会在同一事务里发领域事件（网关据此重算放行表），库里要有事件表。
    const tdb = await createTestDatabase([eventbusMigrations, apiCatalogMigrations]);
    try {
      const projectId = Bun.randomUUIDv7() as ProjectId, serviceId = Bun.randomUUIDv7() as ServiceId;
      const actor: Actor = { userId: Bun.randomUUIDv7() as UserId, isAdmin: true };
      const services = { resolveService: async () => ({ projectId, serviceId, slug: 'issues', identity: 'issues/app' }), resolveServiceIdentity: async () => undefined };
      const deps = { uow: drizzleUnitOfWork(tdb.db), services, projects: { authorize: async () => 'owner', isAdmin: async () => true, readProjectBasics: async () => { throw new Error("unused"); } }, hosts: { platformApiHost: () => 'api.cs.internal' }, clock: systemClock };
      const register = registerReleaseUseCase(deps), query = catalogQueryUseCases(deps);
      const publish = (proxy: string, paths: object) => register({ projectId, serviceId, releaseId: Bun.randomUUIDv7() as ReleaseId, occurredAt: new Date().toISOString(), tag: 'v1.0.0', commitSha: 'a'.repeat(40), manifest: ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind: 'APIProxy', spec: { service: { command: ['app'], port: 3000, servicePlanId: BUILTIN_RESOURCES.servicePlanSmall }, proxy, upstream: { connection: 'upstream' }, apis: { exposes: { openapi: './api.yaml' } } } }), openapiDocument: { openapi: '3.0.3', paths } });
      await publish('issues', { '/issues': { get: { summary: 'Read issues' } } });
      const first = (await query.listOperations(actor))[0]!, proxy = (await query.listProxies(actor))[0]!;
      expect(ResourceIdSchema.safeParse(first.id).success).toBe(true);
      expect(first.proxyId).toBe(proxy.id);
      await setOpenPolicyUseCase(deps)(actor, first.id, 'default');
      await query.renameProxy(actor, proxy.id, 'Issue tracker');
      await publish('issues-v2', { '/issues': { get: { summary: 'Renamed label' } } });
      expect((await query.listOperations(actor))[0]).toMatchObject({ id: first.id, proxyId: proxy.id, proxy: 'issues-v2', openPolicy: 'default' });
      expect((await query.listProxies(actor))[0]).toMatchObject({ id: proxy.id, name: 'Issue tracker' });
      const doc = await prunedOpenApiUseCase(deps)(actor, serviceId, proxy.id);
      expect(doc.paths).toEqual({ '/issues': { get: { summary: 'Renamed label', 'x-crewstation-operation-id': first.id } } });
      await publish('issues-v2', {});
      expect(await query.listOperations(actor)).toHaveLength(0);
      await publish('issues-v2', { '/issues': { get: {} } });
      expect((await query.listOperations(actor))[0]).toMatchObject({ id: first.id, openPolicy: 'default' });
      await expect(setOpenPolicyUseCase(deps)(actor, 'issues-v2:GET:/issues', 'default')).rejects.toMatchObject({ kind: 'not_found' });
    } finally { await tdb.drop(); }
  });
});
