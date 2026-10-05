import { describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, IDENTITY_HEADERS, PROJECT_DELETION_PARTICIPANTS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { createFakeK8sClient } from '@crewstation/k8s';
import { newResourceId, noopLogger, precondition } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { loadPlatformSettings } from '@crewstation/settings';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createPlatformModule, type PlatformModuleDeps } from '../wiring';

const available = await testDatabaseAvailable();
/** Controlled unavailable native ports test actual Root assembly and blocking, never physical reclamation. */
function unavailableSources(): NonNullable<PlatformModuleDeps['deletion']> {
  const unavailable = async () => { throw precondition('original independent physical source unavailable'); };
  const physics = { capture: unavailable, inspect: unavailable, stop: unavailable, purge: unavailable, prove: unavailable };
  return { scm: physics, currentRepositoryOrigins: { read: unavailable }, images: physics, release: physics,
    objects: { inspect: unavailable, run: unavailable }, nativePostgres: { capture: unavailable, verify: unavailable } };
}
describe.skipIf(!available)('actual 22-owner Root composition (no physical cleanup claim)', () => {
  test('production Root protects catalog writes with the pinned native journal even before permanent deletion is enabled', async () => {
    const tdb = await createTestDatabase();
    try {
      const settings = loadPlatformSettings({ CS_DATABASE_URL: tdb.url, CS_PLATFORM_POD_UID: newResourceId(), CS_SECRET_KEY: Buffer.alloc(32, 1).toString('base64'),
        CS_PROJECT_DELETION_GITLAB_SOURCE: JSON.stringify({ baseUrl: 'http://127.0.0.1:9/', instance: { id: 'a'.repeat(64), image: 'sha256:' + 'b'.repeat(64), startedAt: '2026-09-21T04:17:30.022274546Z', epoch: 'c'.repeat(64) } }),
        CS_PROJECT_DELETION_SOURCE_TOKEN: 'original-source-token'.repeat(3), CS_PROJECT_DELETION_GRANT_TOKEN: 'original-grant-token'.repeat(3),
        CS_PROJECT_DELETION_REGISTRY_SOURCE: JSON.stringify({ baseUrl: 'http://127.0.0.1:9/', sourceIdentity: 'd'.repeat(64), journalIdentity: 'e'.repeat(64) }),
        CS_PROJECT_DELETION_REGISTRY_TOKEN: 'original-registry-token'.repeat(3) });
      const root = createPlatformModule({ db: tdb.db, k8s: createFakeK8sClient(), settings, logger: noopLogger, instance: 'native-writer-root' });
      await runMigrations(tdb.db, root.api.migrations);
      const user = await root.modules.identity.api.ensureUser({ externalId: 'native-writer-admin', name: 'Admin', email: 'native@root.invalid' });
      await expect(root.modules.runtimeEnvironment.api.createImage({ userId: user.id, isAdmin: true }, undefined, { name: 'guarded-platform-image', description: '' })).rejects.toThrow();
      expect(await tdb.db.execute(sql`SELECT id FROM runtime_environment.images`)).toHaveLength(0);
      expect(await tdb.db.execute(sql`SELECT id FROM runtime_environment.deletion_callbacks`)).toHaveLength(0);
      expect(root.modules.provisioning.api.deletions).toBeUndefined();
      const app = createApp({ name: 'native-writer-root' }); for (const router of root.api.routers.api) app.route('/', router);
      const capability = await app.request('/v1/project-deletions/capabilities', { headers: { [IDENTITY_HEADERS.userId]: user.id } });
      expect(capability.status).toBe(200); expect(await capability.json()).toEqual({ available: false });
      expect(capability.headers.get('cache-control')).toBe('no-store');
    } finally { await tdb.drop(); }
  }, 30_000);
  test('default Root keeps permanent deletion unavailable; partially configured owners cannot start a controller', async () => {
    const tdb = await createTestDatabase();
    try {
      const settings = loadPlatformSettings({ CS_DATABASE_URL: tdb.url, CS_SECRET_KEY: Buffer.alloc(32,1).toString('base64'), CS_GITLAB_URL: 'http://127.0.0.1:9' });
      const deps = { db: tdb.db, k8s: createFakeK8sClient(), settings, logger: noopLogger, instance: 'partial-deletion-root' };
      const root = createPlatformModule(deps);
      expect(root.modules.provisioning.api.deletions).toBeUndefined();
      expect(() => createPlatformModule({ ...deps, deletion: unavailableSources() })).toThrow('原平台Pod');
      expect(() => createPlatformModule({ ...deps,
        deletion: { ...unavailableSources(), nativePostgres: undefined }, settings: { ...settings, platformPodUid: 'original-pod', clusterMetrics: undefined } })).toThrow('data-control');
      expect(await tdb.db.execute(sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name='project'`)).toHaveLength(0);
    } finally { await tdb.drop(); }
  },30_000);
  test('all actual factories feed admin HTTP inventory; a native-source failure rejects acceptance and preserves both projects', async () => {
    const tdb = await createTestDatabase();
    try {
      const settings = loadPlatformSettings({ CS_DATABASE_URL: tdb.url, CS_PLATFORM_POD_UID: 'controlled-root-pod', CS_SECRET_KEY: Buffer.alloc(32,1).toString('base64'), CS_GITLAB_URL: 'http://127.0.0.1:9' });
      const root = createPlatformModule({ db: tdb.db, k8s: createFakeK8sClient(), settings, logger: noopLogger, instance: 'full-deletion-root', deletion: unavailableSources() });
      await runMigrations(tdb.db,root.api.migrations);
      const user = await root.modules.identity.api.ensureUser({ externalId: 'root-admin', name: 'Admin', email: 'admin@root.invalid' });
      if (!await root.modules.identity.api.isAdmin(user.id)) await root.modules.identity.api.setPlatformRole(user.id,{ expectedRole: 'user', platformRole: 'admin' });
      const member = await root.modules.identity.api.ensureUser({ externalId: 'root-member', name: 'Member', email: 'member@root.invalid' });
      const actor = { userId: user.id,isAdmin: true }, projectApi = root.modules.project.api;
      const create = (slug: string) => projectApi.createProject(actor,{ name: slug,slug,kind: 'DigitalWorker',template: BUILTIN_RESOURCES.minimalTemplate });
      const original = await create('original-delete'), other = await create('other-retained');
      await tdb.db.execute(sql`INSERT INTO data.object_project_policies VALUES(${original.id},'{}'),(${other.id},'{}')`);
      const app = createApp({ name: 'full-deletion-root' }); for (const router of root.api.routers.api) app.route('/',router);
      const capability = await app.request('/v1/project-deletions/capabilities', { headers: { [IDENTITY_HEADERS.userId]: user.id } });
      expect(capability.status).toBe(200); expect(await capability.json()).toEqual({ available: true });
      expect((await app.request('/v1/project-deletions/capabilities', { headers: { [IDENTITY_HEADERS.userId]: member.id } })).status).toBe(403);
      const call = (path: string,body: unknown, userId = user.id) => app.request(path,{ method: 'POST',headers: { 'content-type': 'application/json',[IDENTITY_HEADERS.userId]: userId },body: JSON.stringify(body) });
      expect((await call(`/v1/projects/${original.id}/deletion-plans`,{},member.id)).status).toBe(403);
      const response = await call(`/v1/projects/${original.id}/deletion-plans`,{});
      expect(response.status).toBe(200);
      const plan = await response.json();
      expect(plan.complete).toBe(false);
      expect(plan.participants.map((p: { participant: string }) => p.participant).sort()).toEqual([...PROJECT_DELETION_PARTICIPANTS].sort());
      expect(plan.participants.find((p: { participant: string }) => p.participant === 'data').resources).toContainEqual(expect.objectContaining({ id: 'object_project_policies',count: 1 }));
      for (const participant of ['scm','runtime-environment','release']) expect(plan.participants.find((p: { participant: string }) => p.participant === participant)).toMatchObject({ complete: false });
      expect((await call(`/v1/projects/${original.id}/deletions`,{ planId: plan.id,requestKey: newResourceId(),confirm: 'delete' })).status).toBe(412);
      expect(await projectApi.projectDeletionCoordinator(original.id)).toBeUndefined();
      expect(await root.modules.provisioning.api.deletions!.find(actor,original.id)).toBeUndefined();
      expect(await tdb.db.execute(sql`SELECT project_id FROM data.object_project_policies`)).toHaveLength(2);
      expect(await tdb.db.execute(sql`SELECT project_id FROM data.project_deletions`)).toHaveLength(0);
      expect(await tdb.db.execute(sql`SELECT id FROM project.deletion_operations`)).toHaveLength(0);
      expect((await projectApi.getProject(actor,original.id)).state).not.toBe('deleting');
      expect((await projectApi.getProject(actor,other.id)).state).not.toBe('deleting');
    } finally { await tdb.drop(); }
  },30_000);
  test('the private native permit router uses the actual persistent project owner and cannot create or accept a fabricated operation', async () => {
    const tdb = await createTestDatabase();
    try {
      const token = 'private-native-grant-token'.repeat(2), source = { baseUrl: 'http://native/', instance: {
        id: 'a'.repeat(64), image: 'sha256:' + 'b'.repeat(64), startedAt: '2026-09-21T04:17:30.022274546Z', epoch: 'c'.repeat(64),
      } };
      const settings = loadPlatformSettings({ CS_DATABASE_URL: tdb.url, CS_SECRET_KEY: Buffer.alloc(32,1).toString('base64'),
        CS_PROJECT_DELETION_GITLAB_SOURCE: JSON.stringify(source), CS_PROJECT_DELETION_SOURCE_TOKEN: 'different-source-token'.repeat(3), CS_PROJECT_DELETION_GRANT_TOKEN: token });
      const root = createPlatformModule({ db: tdb.db, k8s: createFakeK8sClient(), settings, logger: noopLogger, instance: 'native-grant-root' });
      await runMigrations(tdb.db,root.api.migrations);
      const app = createApp({ name: 'native-grant-controller' }); for (const router of root.api.routers.controller) app.route('/',router);
      const body = { operationId: newResourceId(), generation: 1, phase: 'stop', target: { id: newResourceId(), slug: 'original', name: 'Original',
        namespace: 'cs-original', kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'original.test', previewHost: 'preview.original.test', serviceHost: 'original.svc.test' },
      confirmed: { participant: 'scm', revision: 'd'.repeat(64), complete: true, resources: [], references: [], blockers: [] } };
      const call = (credential: string) => app.request('/internal/project-deletion/grant', { method: 'POST', headers: {
        authorization: 'Bearer ' + credential, 'content-type': 'application/json',
      }, body: JSON.stringify(body) });
      expect((await call('wrong-token')).status).toBe(401); expect((await call(token)).status).toBe(403);
      expect(await tdb.db.execute(sql`SELECT id FROM project.deletion_operations`)).toHaveLength(0);
      expect(root.modules.provisioning.api.deletions).toBeUndefined();
    } finally { await tdb.drop(); }
  },30_000);
});
