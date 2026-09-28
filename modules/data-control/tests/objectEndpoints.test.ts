import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { generateSecretKey } from '@crewstation/secretbox';
import { dataControlMigrations } from '../wiring';
import { objectEndpointUseCases } from '../application/objectEndpoints';
import { objectEndpointStore } from '../adapters/persistence/objectEndpoints';
import { secretboxCipher } from '../adapters/crypto/secretboxCipher';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
beforeAll(async () => { if (available) tdb = await createTestDatabase([dataControlMigrations]); });
afterAll(async () => { await tdb?.drop(); });
describe.skipIf(!available)('encrypted object endpoints', () => {
  test('retries preserve credentials, rotation does not relocate old objects, and stale writes fail', async () => {
    const id = Bun.randomUUIDv7(), config = { endpoint: 'http://garage:3900', region: 'garage', bucket: 'crewstation-objects', accessKeyId: 'old-key', secretAccessKey: 'sensitive-old-secret' };
    const api = objectEndpointUseCases({ store: objectEndpointStore(tdb.db), cipher: secretboxCipher(generateSecretKey()), probe: async () => undefined });
    await Promise.all([api.configure(id, 1, 1, config), api.configure(id, 1, 1, config)]);
    expect(await api.resolve({ backendId: id, placementRevision: 1 })).toEqual(config);
    const [stored] = await tdb.db.execute<{ body: string }>(sql`SELECT body::text AS body FROM data_control.object_endpoints WHERE backend_id = ${id}`);
    expect(stored?.body).not.toContain(config.secretAccessKey); expect(stored?.body).not.toContain(config.accessKeyId); expect(stored?.body).toContain('v1:');
    await expect(api.configure(id, 1, 1, { ...config, secretAccessKey: 'changed' })).rejects.toThrow('同一凭据修订');
    await expect(api.configure(id, 1, 2, { ...config, endpoint: 'http://other' })).rejects.toThrow('位置不能');
    await api.configure(id, 1, 2, { ...config, secretAccessKey: 'rotated-secret' });
    await expect(api.configure(id, 1, 1, config)).rejects.toThrow('版本已更新');
    expect(await api.resolve({ backendId: id, placementRevision: 1 })).toEqual({ ...config, secretAccessKey: 'rotated-secret' });
    expect(await api.probe(id, 1, new AbortController().signal)).toMatchObject({ credentialRevision: 2, health: 'ready' });
    await expect(api.configure(Bun.randomUUIDv7(), 1, 2, config)).rejects.toThrow('首个');
  });
  test('probe failures redact backend responses and credential values', async () => {
    const id = Bun.randomUUIDv7();
    const api = objectEndpointUseCases({ store: objectEndpointStore(tdb.db), cipher: secretboxCipher(generateSecretKey()), probe: async () => { throw new Error('credential=private'); } });
    await api.configure(id, 1, 1, { endpoint: 'http://garage:3900', region: 'garage', bucket: 'crewstation-objects', accessKeyId: 'key', secretAccessKey: 'secret' });
    const result = await api.probe(id, 1, new AbortController().signal);
    expect(result.health).toBe('unavailable'); expect(JSON.stringify(result)).not.toContain('private');
  });
});
