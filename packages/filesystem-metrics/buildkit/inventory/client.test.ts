import { expect, test } from 'bun:test';
import { buildKitFilesFixture } from './fixture';
import { createBuildKitInventoryClient } from './client';
import { observeBuildKitInventory } from './inventory';
import { createFilesystemMetricsHandler } from '../../server';

const token = 'original-buildkit-probe-token'.repeat(3);
test('the actual authenticated probe and strict client consume full native EOF with fixed query and explicit absence', async () => {
  const f = await buildKitFilesFixture(), handler = createFilesystemMetricsHandler({ token, roots: { local: f.root } });
  const requests: Request[] = [];
  try {
    const client = createBuildKitInventoryClient({ baseUrl: 'http://probe.test/', token, fetch: async (url, init) => { const request = new Request(url, init); requests.push(request.clone()); return handler(request); } });
    const result = await client.observe(f.request);
    expect(result.complete).toBe(true); expect(result.databases).toHaveLength(4); expect(result.files).toHaveLength(4); expect(result.producersClosed).toBe(false);
    expect(requests[0]?.url).toBe('http://probe.test/buildkit/inventory'); expect(requests[0]?.headers.get('authorization')).toBe('Bearer ' + token);
    expect(await requests[0]?.json()).toEqual(f.request);
    const auth = await handler(new Request('http://probe.test/buildkit/inventory', { method: 'POST', body: JSON.stringify(f.request) })); expect(auth.status).toBe(401);
    const wrong = await handler(new Request('http://probe.test/buildkit/inventory', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ ...f.request, directory: '../foreign' }) })); expect(wrong.status).toBe(400);
    const tooLarge = await handler(new Request('http://probe.test/buildkit/inventory', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-length': '1048577' }, body: '{}' })); expect(tooLarge.status).toBe(413);
  } finally { await f.drop(); }
});
test('missing native tables, query substitutions, omitted selected files or databases and unsupported success flags fail closed', async () => {
  const f = await buildKitFilesFixture();
  try {
    const original = await observeBuildKitInventory(f.root, f.request, AbortSignal.timeout(5000));
    const client = (result: unknown) => createBuildKitInventoryClient({ baseUrl: 'http://probe.test/', token, fetch: async () => Response.json(result) });
    for (const changed of [
      { ...original, key: 'substituted' }, { ...original, requestIdentity: 'f'.repeat(64) }, { ...original, databases: original.databases.slice(0, 3) },
      { ...original, files: original.files.slice(1) }, { ...original, files: [...original.files, original.files[0]] },
      { ...original, files: [...original.files, { ...original.files[0], path: 'snapshots/foreign/fs' }] },
      { ...original, files: [...original.files, { ...original.files[0], path: 'snapshots/134/../foreign' }] },
      { ...original, absentStorageIds: ['134'] }, { ...original, complete: false }, { ...original, physicalReclamationProven: true },
    ]) await expect(client(changed).observe(f.request)).rejects.toThrow();
    const unavailable = createBuildKitInventoryClient({ baseUrl: 'http://probe.test/', token, fetch: async () => new Response(null, { status: 503 }) });
    await expect(unavailable.observe(f.request)).rejects.toThrow('unavailable');
    const incomplete = createBuildKitInventoryClient({ baseUrl: 'http://probe.test/', token, fetch: async () => new Response('{') });
    await expect(incomplete.observe(f.request)).rejects.toThrow();
  } finally { await f.drop(); }
});
test('source configuration, caller interruption and an oversized streaming request never fall back to an empty observation', async () => {
  const f = await buildKitFilesFixture();
  try {
    for (const baseUrl of ['http://user:secret@probe.test/', 'http://probe.test/private', 'http://probe.test/?query', 'file:///tmp/']) expect(() => createBuildKitInventoryClient({ baseUrl, token })).toThrow();
    expect(() => createBuildKitInventoryClient({ baseUrl: 'http://probe.test/', token: 'short' })).toThrow();
    const raw = await observeBuildKitInventory(f.root, f.request, AbortSignal.timeout(5000));
    await expect(createBuildKitInventoryClient({ baseUrl: 'http://probe.test/', token, fetch: async () => Response.json(raw) }).observe(f.request, AbortSignal.abort())).rejects.toThrow();
    const handler = createFilesystemMetricsHandler({ token, roots: { local: f.root } });
    const reply = await handler(new Request('http://probe.test/buildkit/inventory', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: ' '.repeat(1_048_577) }));
    expect(reply.status).toBe(400);
  } finally { await f.drop(); }
});
