import { describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { createFakeK8sClient } from '@crewstation/k8s';
import { noopLogger, newResourceId } from '@crewstation/kernel';
import { loadPlatformSettings } from '@crewstation/settings';
import { runMigrations } from '@crewstation/persistence';
import { RegisterObjectBackendSchema } from '@crewstation/contracts';
import { createPlatformModule } from '../wiring';
import { garageAvailable, startGarage } from '../../data-control/tests/garageFixture';

const available = await testDatabaseAvailable() && garageAvailable;
describe.skipIf(!available)('object storage through the actual platform composition', () => {
  test('the administrative rotation reaches the encrypted byte plane and retains public storage identity', async () => {
    const db = await createTestDatabase(), garage = await startGarage();
    try {
      const settings = loadPlatformSettings({ CS_DATABASE_URL: db.url, CS_SECRET_KEY: Buffer.alloc(32, 6).toString('base64'), CS_GITLAB_URL: 'http://127.0.0.1:9' });
      const platform = createPlatformModule({ db: db.db, settings, k8s: createFakeK8sClient(), logger: noopLogger, instance: 'storage-composition' });
      await runMigrations(db.db, platform.api.migrations);
      const user = await platform.modules.identity.api.ensureUser({ externalId: 'storage-admin', name: 'Storage', email: 'storage@test.invalid' }), actor = { userId: user.id, isAdmin: true };
      const api = platform.modules.data.api.objects!;
      const backend = await api.registerBackend(actor, RegisterObjectBackendSchema.parse({ requestKey: newResourceId(), name: 'composition', ...garage.config, durability: 'dev-only' }));
      const credentials = await garage.issueCredentials();
      const result = await api.rotateCredential(actor, backend.id, { requestKey: newResourceId(), expectedRevision: backend.revision, reason: 'isolated integration proof', confirmation: 'rotate', ...credentials });
      expect(result).toMatchObject({ id: backend.id, placementRevision: backend.placementRevision, credentialRevision: 2, endpoint: backend.endpoint, bucket: backend.bucket });
      expect(JSON.stringify(result)).not.toContain(credentials.secretAccessKey);
      expect((await api.backends(actor))[0]?.credentialRevision).toBe(2);
    } finally { await garage.dispose(); await db.drop(); }
  }, 60_000);
});
