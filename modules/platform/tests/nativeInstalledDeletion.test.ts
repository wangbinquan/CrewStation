import { describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, IDENTITY_HEADERS, PROJECT_DELETION_PARTICIPANTS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { createFakeK8sClient } from '@crewstation/k8s';
import { newResourceId, noopLogger } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { loadPlatformSettings } from '@crewstation/settings';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { createPlatformModule } from '../wiring';
const available = await testDatabaseAvailable();

describe.skipIf(!available)('production deletion assembly from installed native configuration', () => {
  test('all actual factories compose without injected deletion owners; a missing independent installation blocks acceptance', async () => {
    const tdb = await createTestDatabase();
    try {
      const settings = loadPlatformSettings({ CS_DATABASE_URL: tdb.url, CS_PLATFORM_POD_UID: newResourceId(), CS_SECRET_KEY: Buffer.alloc(32, 1).toString('base64'), CS_GITLAB_URL: 'http://127.0.0.1:9',
        CS_STORAGE_PROBE_TOKEN: 'installed-probe-token'.repeat(3), CS_STORAGE_PROBE_HOST_ROOT: '/original-volumes',
        CS_PROJECT_DELETION_GITLAB_SOURCE: JSON.stringify({ baseUrl: 'http://127.0.0.1:9/', instance: { id: 'a'.repeat(64), image: 'sha256:' + 'b'.repeat(64), startedAt: '2026-09-21T04:17:30.022274546Z', epoch: 'c'.repeat(64) } }),
        CS_PROJECT_DELETION_SOURCE_TOKEN: 'original-source-token'.repeat(3), CS_PROJECT_DELETION_GRANT_TOKEN: 'original-grant-token'.repeat(3),
        CS_PROJECT_DELETION_REGISTRY_SOURCE: JSON.stringify({ baseUrl: 'http://127.0.0.1:9/', sourceIdentity: 'd'.repeat(64), journalIdentity: 'e'.repeat(64) }), CS_PROJECT_DELETION_REGISTRY_TOKEN: 'original-registry-token'.repeat(3),
        CS_PROJECT_DELETION_WORK_SOURCES: JSON.stringify({ registry: { imageDigest: 'sha256:' + 'f'.repeat(64) }, buildkit: { imageDigest: 'sha256:' + '1'.repeat(64), configIdentity: '2'.repeat(64), args: ['--addr', 'tcp://0.0.0.0:1234'] } }) });
      const deps = { db: tdb.db, k8s: createFakeK8sClient(), settings, logger: noopLogger, instance: 'installed-native-root' };
      expect(() => createPlatformModule({ ...deps, settings: { ...settings, platformPodUid: undefined } })).toThrow('原节点探针');
      const root = createPlatformModule(deps); await runMigrations(tdb.db, root.api.migrations);
      expect(root.modules.provisioning.api.deletions).toBeDefined();
      const user = await root.modules.identity.api.ensureUser({ externalId: 'installed-admin', name: 'Admin', email: 'installed@root.invalid' });
      if (!await root.modules.identity.api.isAdmin(user.id)) await root.modules.identity.api.setPlatformRole(user.id, { expectedRole: 'user', platformRole: 'admin' });
      const actor = { userId: user.id, isAdmin: true }, original = await root.modules.project.api.createProject(actor, { name: 'Original', slug: 'original', kind: 'DigitalWorker', template: BUILTIN_RESOURCES.minimalTemplate });
      const app = createApp({ name: 'installed-native-root' }); for (const router of root.api.routers.api) app.route('/', router);
      const headers = { [IDENTITY_HEADERS.userId]: user.id, 'content-type': 'application/json' };
      expect(await (await app.request('/v1/project-deletions/capabilities', { headers })).json()).toEqual({ available: true });
      const response = await app.request(`/v1/projects/${original.id}/deletion-plans`, { method: 'POST', headers, body: '{}' });
      expect(response.status).toBe(200); const plan = await response.json(); expect(plan.complete).toBe(false);
      expect(plan.participants.map((row: { participant: string }) => row.participant).sort()).toEqual([...PROJECT_DELETION_PARTICIPANTS].sort());
      for (const name of ['runtime-environment', 'release']) expect(plan.participants.find((row: { participant: string }) => row.participant === name)).toMatchObject({ complete: false });
      expect((await app.request(`/v1/projects/${original.id}/deletions`, { method: 'POST', headers, body: JSON.stringify({ planId: plan.id, requestKey: newResourceId(), confirm: 'delete' }) })).status).toBe(412);
      expect((await root.modules.project.api.getProject(actor, original.id)).state).not.toBe('deleting');
    } finally { await tdb.drop(); }
  }, 30_000);
});
