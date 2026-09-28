import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { Actor, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import type { Transaction } from '@crewstation/persistence';
import { generateSecretKey } from '@crewstation/secretbox';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { dataControlMigrations } from '../../data-control/wiring';
import { objectEndpointStore } from '../../data-control/adapters/persistence/objectEndpoints';
import { secretboxCipher } from '../../data-control/adapters/crypto/secretboxCipher';
import { objectEndpointUseCases } from '../../data-control/application/objectEndpoints';
import { prepareObjectCredentialRotation } from '../../data-control/application/objectCredentialRotation';
import { dataMigrations } from '../wiring';
import { objectCredentialRotations } from '../adapters/persistence/objectRotation';
import { objectAdministration } from '../application/objectAdministration';
import { objectAdminRoutes } from '../http/objectAdminRoutes';
import type { ObjectBackendPlane } from '../ports/objectStorage';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectId } from './objectFixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('atomic backend credential rotation across data and data-control', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([dataControlMigrations, dataMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  async function fixture() {
    const f = await objectArchiveFixture(tdb.db), cipher = secretboxCipher(generateSecretKey()), store = objectEndpointStore(tdb.db), rotations = objectCredentialRotations(tdb.db);
    const config = { endpoint: f.backend.endpoint, region: f.backend.region, bucket: f.backend.bucket, accessKeyId: 'old-key', secretAccessKey: 'private-old-secret', monitoring: { endpoint: 'http://garage:3903', token: 'old-observation-token' } };
    const endpoints = objectEndpointUseCases({ store, cipher, probe: async () => {} }); await endpoints.configure(f.backend.id, 1, 1, config);
    const behavior = { probes: 0, failAfterSwap: false };
    const prepareRotation = prepareObjectCredentialRotation({ store, cipher, probe: async (candidate) => { behavior.probes++; if (candidate.accessKeyId === 'invalid') throw new Error('private probe response'); },
      within: (tx) => { const stored = objectEndpointStore(tx as Transaction); return { ...stored, put: async (value) => { const result = await stored.put(value); if (behavior.failAfterSwap) throw new Error('database write interrupted'); return result; } }; } });
    const actor: Actor = { userId: objectId() as UserId, isAdmin: true }, plane = { prepareRotation } as ObjectBackendPlane;
    const api = objectAdministration({ ...f, plane, rotations, authorizer: { authorize: async () => {} } });
    const app = createApp({ name: 'object-rotation' }); app.route('/', objectAdminRoutes(api, async (id) => id === actor.userId));
    const input = { requestKey: 'rotate', expectedRevision: 1, accessKeyId: 'new-key', secretAccessKey: 'private-new-secret', reason: '例行更换访问密钥', confirmation: 'rotate' as const };
    return { ...f, actor, endpoints, config, api, app, input, behavior, rotations };
  }
  test('invalid and half-committed rotations keep the old key; success and lost HTTP replies preserve immutable locations and exact audit', async () => {
    const f = await fixture(), location = { backendId: f.backend.id, placementRevision: 1 };
    const oldObject = await f.reads.object(f.object.id);
    await expect(f.api.rotateCredential({ ...f.actor, isAdmin: false }, f.backend.id, f.input)).rejects.toMatchObject({ kind: 'forbidden' }); expect(f.behavior.probes).toBe(0);
    await expect(f.api.rotateCredential(f.actor, f.backend.id, { ...f.input, accessKeyId: 'invalid' })).rejects.toMatchObject({ message: '新凭据不能访问原对象桶，未切换凭据' });
    expect(await f.endpoints.resolve(location)).toEqual(f.config); expect((await f.catalog.backend(f.backend.id))!.credentialRevision).toBe(1);
    f.behavior.failAfterSwap = true;
    await expect(f.api.rotateCredential(f.actor, f.backend.id, f.input)).rejects.toThrow('interrupted');
    expect(await f.endpoints.resolve(location)).toEqual(f.config); expect(await f.rotations.get(f.backend.id, f.input.requestKey)).toBeUndefined();
    expect((await f.catalog.backend(f.backend.id))!.revision).toBe(1);
    f.behavior.failAfterSwap = false;
    const changed = await f.api.rotateCredential(f.actor, f.backend.id, f.input), probes = f.behavior.probes;
    expect(changed).toMatchObject({ revision: 2, credentialRevision: 2, placementRevision: 1, endpoint: f.backend.endpoint, bucket: f.backend.bucket, health: 'unknown' });
    expect(await f.endpoints.resolve(location)).toEqual({ ...f.config, accessKeyId: f.input.accessKeyId, secretAccessKey: f.input.secretAccessKey });
    expect(await f.api.rotateCredential(f.actor, f.backend.id, f.input)).toEqual(changed); expect(f.behavior.probes).toBe(probes);
    await expect(f.api.rotateCredential(f.actor, f.backend.id, { ...f.input, secretAccessKey: 'different' })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await f.reads.object(f.object.id)).toEqual(oldObject);
    expect(await f.rotations.get(f.backend.id, f.input.requestKey)).toMatchObject({ actorId: f.actor.userId, reason: f.input.reason });
    const [audit] = await tdb.db.execute<{ body: string }>(sql`SELECT body::text AS body FROM data.object_credential_rotations WHERE backend_id=${f.backend.id}`);
    const [vault] = await tdb.db.execute<{ body: string }>(sql`SELECT body::text AS body FROM data_control.object_endpoints WHERE backend_id=${f.backend.id}`);
    for (const data of [JSON.stringify(changed), audit!.body, vault!.body]) { expect(data).not.toContain(f.input.secretAccessKey); expect(data).not.toContain(f.input.accessKeyId); }
    expect(await f.catalog.observeBackend({ ...location, credentialRevision: 1, health: 'ready', freeBytes: null, totalBytes: null, observedAt: new Date().toISOString(), message: null })).toBe(false);
  });
  test('competing rotations have one winner; backup freeze, stale form revisions and HTTP spoofing cannot change credentials', async () => {
    const f = await fixture(), root = `/v3/admin/object-storage/backends/${f.backend.id}/rotate-credential`;
    const request = (value: unknown, id = f.actor.userId) => f.app.request(root, { method: 'POST', headers: { [IDENTITY_HEADERS.userId]: id, 'content-type': 'application/json' }, body: JSON.stringify(value) });
    expect((await request(f.input, objectId() as UserId)).status).toBe(403);
    expect((await request({ ...f.input, endpoint: 'http://another-bucket' })).status).toBe(400);
    expect((await request({ ...f.input, confirmation: 'yes' })).status).toBe(400);
    const freeze = { id: objectId(), backendId: f.backend.id, kind: 'backup' as const, epoch: 1, active: true }; await f.catalog.freeze(freeze);
    expect((await request(f.input)).status).toBe(412); expect(await f.endpoints.resolve({ backendId: f.backend.id, placementRevision: 1 })).toEqual(f.config);
    await f.catalog.freeze({ ...freeze, active: false });
    const other = { ...f.input, requestKey: 'another', accessKeyId: 'second-key', monitoringToken: 'new-observation-token' };
    const results = await Promise.all([request(f.input), request(other)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results[0]!.status === 200 ? f.input : other;
    expect((await f.endpoints.resolve({ backendId: f.backend.id, placementRevision: 1 })).accessKeyId).toBe(winner.accessKeyId);
    expect((await f.catalog.backend(f.backend.id))!.credentialRevision).toBe(2);
    expect((await request({ ...f.input, requestKey: 'stale-form' })).status).toBe(409);
  });
});
