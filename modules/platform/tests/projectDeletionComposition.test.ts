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
});
