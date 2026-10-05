import { describe, expect, test } from 'bun:test';
import { jsonHash } from '@crewstation/kernel';
import { createGitLabStorageClient, parseGitLabStorageOutput } from './client';
import { createGitLabStorageHandler } from './server';
import { GitLabStorageInventorySchema, GitLabStorageRequestSchema } from './protocol';
import { reviseStorage, storageFixture } from './fixture';

const token = 'storage-private-source'.padEnd(48, '0');
const output = (value: unknown) => 'CS_GITLAB_STORAGE=' + JSON.stringify(value);
function setup() {
  const f = storageFixture(), calls: unknown[] = [];
  const observer = { inspect: async () => ({ ...f.instance }), read: async (request: unknown) => { calls.push(request); return output(f.inventory); } };
  const handler = createGitLabStorageHandler({ token, instance: f.instance, roots: f.roots, observer });
  const client = createGitLabStorageClient({ token, baseUrl: 'http://native.test', instance: f.instance, roots: f.roots,
    fetch: (async (url, init) => handler(new Request(String(url), init))) as typeof fetch });
  return { ...f, observer, calls, handler, client };
}
describe('retained GitLab original filesystem source', () => {
  test('actual handler and SDK retain directory, byte, birth and explicit absence without native model access', async () => {
    const f = setup(), result = await f.client.observe(f.request);
    expect(result.inventory.locations.map(location => location.present)).toEqual([true, true, false]);
    expect(result.inventory.locations[0]!.entries[1]).toMatchObject({ bytes: 19, allocatedBytes: 4096, inode: '18446744073709551615' });
    expect(result.inventory).toMatchObject({ physicalReclamationProven: false, producersClosed: false, consumersStopped: false });
    expect(f.calls).toEqual([f.request]);
    f.inventory.locations[0]!.present = false; f.inventory.locations[0]!.entries = []; reviseStorage(f.inventory);
    expect((await f.client.observe(f.request)).inventory.locations[0]!.present).toBe(false);
    expect(f.calls).toHaveLength(2);
  });
  test('missing or altered roots, forged file births, cross-device bytes, duplicate or escaped entries fail closed', () => {
    for (const change of ['root missing', 'root duplicate', 'root unpinned', 'epoch', 'duplicate', 'escape', 'device', 'missing root entry', 'false absence', 'true proof', 'digest']) {
      const f = storageFixture(), value = f.inventory, entry = value.locations[0]!.entries[1]!;
      if (change === 'root missing') value.roots.pop();
      if (change === 'root duplicate') value.roots[6] = structuredClone(value.roots[0]!);
      if (change === 'root unpinned') value.roots[0]!.identity = null;
      if (change === 'epoch') entry.birthtimeNs = '1';
      if (change === 'duplicate') value.locations[0]!.entries.push(structuredClone(entry));
      if (change === 'escape') entry.path = '@hashed/foreign.git/file';
      if (change === 'device') { entry.device = '1'; entry.identity = jsonHash({ device: entry.device, inode: entry.inode, birthtimeNs: entry.birthtimeNs, kind: entry.kind }); }
      if (change === 'missing root entry') value.locations[0]!.entries.shift();
      if (change === 'false absence') value.locations[0]!.present = false;
      if (change === 'true proof') (value as unknown as Record<string, unknown>)['producersClosed'] = true;
      if (change === 'digest') entry.bytes = 29;
      if (change !== 'digest') reviseStorage(value);
      expect(() => GitLabStorageInventorySchema.parse(value)).toThrow();
    }
  });
  test('matching digests cannot authorize a different location or root configuration', () => {
    for (const change of ['scope', 'request', 'root']) {
      const f = storageFixture(), value = f.inventory;
      if (change === 'scope') value.locations[0]!.key = 'foreign scope';
      if (change === 'request') value.requestDigest = 'c'.repeat(64);
      if (change === 'root') value.roots[0]!.path = '/var/opt/gitlab/foreign-root';
      reviseStorage(value); expect(() => parseGitLabStorageOutput(output(value), f.request, f.roots === value.roots ? storageFixture().roots : f.roots)).toThrow();
    }
  });
  test('a replacement installation, namespace or source lost after reading cannot supply a snapshot', async () => {
    for (const change of ['id', 'image', 'birth', 'namespace', 'after']) {
      const f = setup(); let count = 0;
      if (change === 'id') f.instance.id = 'c'.repeat(64);
      if (change === 'image') f.instance.image = 'sha256:' + 'c'.repeat(64);
      if (change === 'birth') f.instance.startedAt = '2026-10-05T00:00:00Z';
      if (change === 'namespace') f.inventory.runtime.namespace = 'pid:[51]';
      if (change === 'after') f.observer.inspect = async () => (++count === 1 ? { ...f.instance } : { ...f.instance, id: 'c'.repeat(64) });
      await expect(f.client.observe(f.request)).rejects.toThrow();
      if (['id', 'image', 'birth'].includes(change)) expect(f.calls).toHaveLength(0);
    }
  });
  test('caller mutations cannot move a paused inventory to a different path', async () => {
    const f = setup(); let finish!: () => void, entered!: () => void;
    const begun = new Promise<void>(resolve => { entered = resolve; }), paused = new Promise<void>(resolve => { finish = resolve; });
    const original = f.observer.read;
    f.observer.read = async request => { entered(); await paused; return original(request); };
    const pending = f.client.observe(f.request); await begun; f.request.locations[0]!.relative = '@hashed/foreign.git'; finish();
    expect((await pending).inventory.locations[0]!.relative).toBe('@hashed/original.git');
    expect(f.calls[0]).toMatchObject({ locations: [{ relative: '@hashed/original.git' }, {}, {}] });
  });
  test('authentication, body budget, busy state and cancelled reads do not certify completion', async () => {
    const f = setup(), url = 'http://native.test/native/gitlab/storage', headers = { authorization: 'Bearer ' + token };
    expect((await f.handler(new Request('http://native.test/other'))).status).toBe(404);
    expect((await f.handler(new Request(url))).status).toBe(405);
    expect((await f.handler(new Request(url, { method: 'POST' }))).status).toBe(401);
    expect((await f.handler(new Request(url, { method: 'POST', headers }))).status).toBe(503);
    expect((await f.handler(new Request(url, { method: 'POST', headers, body: 'x'.repeat(32_769) }))).status).toBe(503);
    let finish!: () => void, entered!: () => void;
    const begun = new Promise<void>(resolve => { entered = resolve; }), paused = new Promise<void>(resolve => { finish = resolve; });
    f.observer.read = async () => { entered(); await paused; return output(f.inventory); };
    const abort = new AbortController(), pending = f.handler(new Request(url, { method: 'POST', headers, body: JSON.stringify(f.request), signal: abort.signal }));
    await begun; expect((await f.handler(new Request(url, { method: 'POST', headers, body: JSON.stringify(f.request) }))).status).toBe(409);
    abort.abort(); finish(); expect((await pending).status).toBe(499);
  });
  test('malformed paths and bounded transport failures never become an empty successful inventory', async () => {
    const f = setup();
    for (const path of ['', '../foreign', '/foreign', 'a//b', 'a/./b', 'a/../b', 'a\0b', '\ud800']) expect(() => GitLabStorageRequestSchema.parse({ locations: [{ ...f.request.locations[0], relative: path }] })).toThrow();
    expect(() => GitLabStorageRequestSchema.parse({ locations: [f.request.locations[0], f.request.locations[0]] })).toThrow();
    const create = (fetcher: (input: Parameters<typeof fetch>[0]) => Promise<Response>) => createGitLabStorageClient({ token, baseUrl: 'http://native.test', instance: f.instance, roots: f.roots, fetch: fetcher as typeof fetch });
    for (const response of [new Response(null, { status: 503 }), new Response(null), new Response(new Uint8Array([255])), new Response('x'.repeat(8_388_609)), new Response('{}')])
      await expect(create(async () => response).observe(f.request)).rejects.toThrow();
    const stale = { before: f.instance, after: f.instance, inventory: { ...f.inventory, observedAt: '2026-09-01T00:00:00Z' } };
    await expect(create(async () => Response.json(stale)).observe(f.request)).rejects.toThrow();
    for (const text of ['', output(f.inventory) + '\n' + output(f.inventory), 'x'.repeat(8_388_609)]) expect(() => parseGitLabStorageOutput(text, f.request, f.roots)).toThrow();
    expect(() => createGitLabStorageClient({ token: 'short', baseUrl: 'http://native.test', instance: f.instance, roots: f.roots })).toThrow();
    expect(() => createGitLabStorageHandler({ token: 'short', instance: f.instance, roots: f.roots, observer: f.observer })).toThrow();
    for (const baseUrl of ['ftp://native.test', 'http://user:pass@native.test', 'http://native.test/path', 'http://native.test?query=1', 'http://native.test#hash'])
      expect(() => createGitLabStorageClient({ token, baseUrl, instance: f.instance, roots: f.roots })).toThrow();
    await expect(f.client.observe({ locations: Array.from({ length: 128 }, (_, i) => ({ key: String(i), root: 'repository', relative: 'x'.repeat(4000), mode: 'tree' })) })).rejects.toThrow();
  });
});
