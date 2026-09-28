import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { forbidden, notFound } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { objectAdministration } from '../application/objectAdministration';
import { objectAdminRoutes } from '../http/objectAdminRoutes';
import { dataMigrations } from '../wiring';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectId } from './objectFixtures';
import type { ObjectBackendPlane } from '../ports/objectStorage';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
beforeAll(async () => { if (available) tdb = await createTestDatabase([dataMigrations]); });
afterAll(async () => { await tdb?.drop(); });

async function fixture() {
  const f = await objectArchiveFixture(tdb.db), owner: Actor = { userId: objectId() as UserId, isAdmin: false };
  let calls = 0, missing = false;
  const plane = { get: async (_location, input) => {
    calls++; if (missing) throw notFound('physical object');
    expect(input.expected).toEqual({ size: 100, sha256: 'a'.repeat(64) });
    const size = input.range ? 10 : 100;
    return { body: new ReadableStream<Uint8Array>({ start: (c) => { c.enqueue(new Uint8Array(size).fill(120)); c.close(); } }), size,
      ...(input.range ? { contentRange: 'bytes 0-9/100' } : {}), completed: Promise.resolve({ size, sha256: 'a'.repeat(64) }) };
  } } as ObjectBackendPlane;
  const api = objectAdministration({ catalog: f.catalog, reads: f.reads, plane, downloads: { content: f.content, owner: objectId() },
    authorizer: { authorize: async (actor, projectId) => { if (actor.userId !== owner.userId || projectId !== f.source.projectId) throw forbidden(); } } });
  const app = createApp({ name: 'object-console-download' }); app.route('/', objectAdminRoutes(api, async () => false));
  const path = `/v3/object-storage/objects/${f.object.id}/content`, headers = { [IDENTITY_HEADERS.userId]: owner.userId };
  return { ...f, owner, app, path, headers, calls: () => calls, lose: () => { missing = true; } };
}

describe.skipIf(!available)('console artifact download', () => {
  test('checks membership before opening content; a read uses shared capacity until the response finishes', async () => {
    const f = await fixture();
    expect((await f.app.request(f.path)).status).toBe(401);
    expect((await f.app.request(f.path, { headers: { [IDENTITY_HEADERS.userId]: objectId() } })).status).toBe(404);
    expect(f.calls()).toBe(0);
    const response = await f.app.request(f.path, { headers: f.headers });
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('content-disposition')).toContain('attachment;');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-cs-object-sha256')).toBe(f.object.sha256);
    expect((await f.catalog.space(f.space.id))?.activeTransfers).toBe(1);
    expect((await response.arrayBuffer()).byteLength).toBe(100);
    expect((await f.catalog.space(f.space.id))?.activeTransfers).toBe(0);
    expect(await f.reads.queue([f.space.id])).toMatchObject({ activeDownloads: 0, unknownDownloads: 0 });
  });
  test('Range forwards through the same stream and missing bytes degrade the object, without leaking a transfer slot', async () => {
    const f = await fixture(), response = await f.app.request(f.path, { headers: { ...f.headers, range: 'bytes=0-9' } });
    expect(response.status).toBe(206); expect(response.headers.get('content-range')).toBe('bytes 0-9/100');
    expect((await response.arrayBuffer()).byteLength).toBe(10);
    f.lose();
    const lost = await f.app.request(f.path, { headers: f.headers });
    expect(lost.status).toBe(412); expect(await lost.text()).toContain('object_content_degraded');
    expect((await f.reads.object(f.object.id))?.state).toBe('degraded');
    expect((await f.catalog.space(f.space.id))?.activeTransfers).toBe(0);
    expect((await f.app.request(f.path, { headers: f.headers })).status).toBe(412);
    expect(f.calls()).toBe(2);
  });
});
