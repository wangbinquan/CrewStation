import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { ManifestSchema, type ServiceId } from '@crewstation/contracts';
import { createFakeK8sClient } from '@crewstation/k8s';
import { noopLogger } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { loadPlatformSettings } from '@crewstation/settings';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { createPlatformModule } from '../wiring';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('external webhook composition with real PostgreSQL', () => {
  test('ready production opens exact ingress; maintenance and offline revoke access immediately', async () => {
    const db = await createTestDatabase();
    try {
      const settings = loadPlatformSettings({ CS_DATABASE_URL: db.url, CS_SECRET_KEY: Buffer.alloc(32, 3).toString('base64'), CS_GITLAB_URL: 'http://127.0.0.1:9' });
      const platform = createPlatformModule({ db: db.db, settings, k8s: createFakeK8sClient(), logger: noopLogger, instance: 'webhook-ingress' });
      await runMigrations(db.db, platform.api.migrations);
      const { identity, project, gateway } = platform.modules;
      const user = await identity.api.ensureUser({ externalId: 'webhook-admin', name: 'Admin', email: 'admin@webhook.test' });
      const actor = { userId: user.id, isAdmin: true };
      const p = await project.api.createProject(actor, { name: 'Webhook', slug: 'webhook-test', kind: 'EventProducer', template: '01a0bf5d-8f4b-7004-9cf7-0eb8bf66ffbd' });
      await project.api.setProjectState(p.id, 'active');
      const request = { host: `webhook-test.${settings.serviceDomain}`, method: 'POST', uri: '/hooks/github', forwardedFor: '192.0.2.8' };
      const authorize = () => identity.api.authorizeServiceRequest(request);
      expect(await authorize()).toMatchObject({ kind: 'forbidden' });
      const id = Bun.randomUUIDv7();
      const manifest = ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind: 'EventProducer', spec: {
        service: { command: ['bun', 'run', 'src/main.ts'], port: 3000, servicePlanId: Bun.randomUUIDv7() }, producer: 'github',
        ingress: { path: '/hooks/github', verification: 'hmac-sha256' }, produces: [{ eventType: 'github.push' }],
      } });
      await db.db.execute(sql`INSERT INTO release.releases (id, service_id, project_id, tag, commit_sha, branch, status, target_slot, manifest, pipeline, created_by, created_at, updated_at) VALUES (${id}, ${p.serviceId}, ${p.id}, 'v1.0.0', ${'a'.repeat(40)}, 'main', 'ready', 'blue', ${JSON.stringify(manifest)}::text::jsonb, '{}', ${user.id}, now(), now())`);
      const ready = { state: 'ready', releaseId: id, replicas: 1, updatedAt: new Date().toISOString() };
      const empty = { state: 'empty', replicas: 0, updatedAt: new Date().toISOString() };
      await db.db.execute(sql`INSERT INTO release.service_slots (service_id, active, blue, green, updated_at) VALUES (${p.serviceId}, 'blue', ${JSON.stringify(ready)}::text::jsonb, ${JSON.stringify(empty)}::text::jsonb, now())`);
      expect(await authorize()).toMatchObject({ kind: 'webhook' });
      expect(await identity.api.authorizeServiceRequest({ ...request, uri: '/api' })).toMatchObject({ kind: 'forbidden' });
      await gateway.api.setMaintenance(actor, p.serviceId as ServiceId, { switches: { users: false, services: true, events: false }, allowUserIds: [], reason: 'upgrade', expectedRevision: 0 });
      expect(await authorize()).toMatchObject({ kind: 'unavailable', message: 'upgrade' });
      await db.db.execute(sql`UPDATE release.service_slots SET blue = ${JSON.stringify(empty)}::text::jsonb WHERE service_id = ${p.serviceId}`);
      expect(await authorize()).toMatchObject({ kind: 'forbidden' });
    } finally { await db.drop(); }
  });
});
