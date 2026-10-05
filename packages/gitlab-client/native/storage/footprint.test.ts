import { describe, expect, test } from 'bun:test';
import { jsonHash } from '@crewstation/kernel';
import { nativeFixture } from '../fixture';
import { storageFixture } from './fixture';
import { createGitLabFootprintClient, createGitLabFootprintHandler, parseGitLabFootprintOutput } from './footprint';

const token = 'original-footprint-private-token-'.repeat(2);
const testFetch = (handler: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>) => handler as typeof fetch;
function fixture() {
  const f = nativeFixture(), storage = storageFixture().inventory;
  storage.roots = structuredClone(f.inventory.roots); storage.runtime = structuredClone(f.inventory.runtime);
  storage.requestDigest = jsonHash({ locations: storage.locations.map(({ present: _present, entries: _entries, ...row }) => row) });
  storage.revision = jsonHash({ roots: storage.roots, locations: storage.locations });
  return { ...f, footprint: { version: 1 as const, nativeRevision: f.inventory.nativeRevision, inventory: storage } };
}
const output = (f: ReturnType<typeof fixture>) => 'CS_GITLAB_FOOTPRINT=' + JSON.stringify(f.footprint);
function handler(f: ReturnType<typeof fixture>, change?: (stage: string) => void) {
  return createGitLabFootprintHandler({ token, instance: f.instance, roots: f.inventory.roots, observer: {
    inspect: async () => { change?.('inspect'); return f.instance; }, read: async (query) => {
      expect(query.original.project.id).toBe('383'); change?.('read'); return output(f);
    },
  } });
}

describe('project footprint transport', () => {
  test('the independent file source is bound to the complete original native snapshot and roots', async () => {
    const f = fixture(), serve = handler(f), client = createGitLabFootprintClient({ baseUrl: 'http://private/', token, instance: f.instance,
      fetch: testFetch(async (input, init) => serve(new Request(input, init))) });
    const result = await client.observe(f.inventory);
    expect(result.footprint).toEqual(f.footprint);
    expect(result.footprint.inventory.locations.some(row => !row.present)).toBe(true);
    expect(result.footprint.inventory.physicalReclamationProven).toBe(false);
    expect(result.footprint.inventory.consumersStopped).toBe(false);
    expect(parseGitLabFootprintOutput(output(f) + '\n', f.inventory)).toEqual(f.footprint);
  });
  test('replaced roots, instance, namespace, digest, malformed or oversized output cannot become complete', async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => { f.footprint.nativeRevision = 'e'.repeat(64); },
      (f: ReturnType<typeof fixture>) => { f.footprint.inventory.requestDigest = 'e'.repeat(64); },
      (f: ReturnType<typeof fixture>) => { f.footprint.inventory.runtime.namespace = 'pid:[18]'; },
      (f: ReturnType<typeof fixture>) => { f.footprint.inventory.roots[0]!.identity!.inode = '2'; f.footprint.inventory.revision = jsonHash({ roots: f.footprint.inventory.roots, locations: f.footprint.inventory.locations }); },
    ]) {
      const f = fixture(); mutate(f); expect(() => parseGitLabFootprintOutput(output(f), f.inventory)).toThrow();
    }
    const f = fixture();
    for (const value of ['noise\n' + output(f), output(f) + '\n{}', 'CS_GITLAB_FOOTPRINT={}', 'x'.repeat(8_388_609)])
      expect(() => parseGitLabFootprintOutput(value, f.inventory)).toThrow();
    const replaced = handler(f, stage => { if (stage === 'read') f.instance.id = 'c'.repeat(64); });
    expect((await replaced(new Request('http://private/native/gitlab/footprint', { method: 'POST', body: JSON.stringify({ original: f.inventory }), headers: { authorization: 'Bearer ' + token } }))).status).toBe(503);
  });
  test('authentication, route, method, unknown fields and concurrent source reads are rejected', async () => {
    const f = fixture(), serve = handler(f), request = (url: string, method = 'POST', authorization = 'Bearer ' + token, body = JSON.stringify({ original: f.inventory })) => new Request(url, { method, headers: { authorization }, ...(method === 'POST' ? { body } : {}) });
    expect((await serve(request('http://private/wrong'))).status).toBe(404);
    expect((await serve(request('http://private/native/gitlab/footprint', 'GET'))).status).toBe(405);
    expect((await serve(request('http://private/native/gitlab/footprint', 'POST', 'wrong'))).status).toBe(401);
    expect((await serve(request('http://private/native/gitlab/footprint', 'POST', 'Bearer ' + token, JSON.stringify({ original: f.inventory, root: '/foreign' })))).status).toBe(503);
    let release!: () => void; const paused = new Promise<void>(resolve => { release = resolve; });
    const busy = createGitLabFootprintHandler({ token, instance: f.instance, roots: f.inventory.roots,
      observer: { inspect: async () => f.instance, read: async () => { await paused; return output(f); } } });
    const first = busy(request('http://private/native/gitlab/footprint'));
    expect((await busy(request('http://private/native/gitlab/footprint'))).status).toBe(409); release(); expect((await first).status).toBe(200);
    expect(() => createGitLabFootprintHandler({ token: 'short', instance: f.instance, roots: f.inventory.roots, observer: { inspect: async () => f.instance, read: async () => '' } })).toThrow();
  });
  test('client input and original source are frozen before awaiting and stale, substituted or broken replies fail', async () => {
    const f = fixture(), originalId = f.instance.id; let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const client = createGitLabFootprintClient({ baseUrl: 'http://private/', token, instance: f.instance, fetch: testFetch(async (_input, init) => {
      await ready; expect(JSON.parse(init!.body as string).original.project.id).toBe('383');
      return Response.json({ before: { ...f.instance, id: originalId }, after: { ...f.instance, id: originalId }, footprint: f.footprint });
    }) });
    const pending = client.observe(f.inventory); f.inventory.project.id = '999'; f.instance.id = 'c'.repeat(64); release();
    expect((await pending).footprint.nativeRevision).toBe(f.footprint.nativeRevision);
    for (const makeReply of [
      (value: ReturnType<typeof fixture>) => Response.json({ before: { ...value.instance, id: 'd'.repeat(64) }, after: value.instance, footprint: value.footprint }),
      (value: ReturnType<typeof fixture>) => { value.footprint.inventory.observedAt = '2020-01-01T00:00:00Z'; return Response.json({ before: value.instance, after: value.instance, footprint: value.footprint }); },
      () => new Response(null, { status: 503 }), () => new Response(new Uint8Array([0xff])), () => new Response('x'.repeat(8_388_609)),
      () => new Response(new ReadableStream({ start(control) { control.error(Error('source-read-failed')); } })),
    ]) {
      const value = fixture(), invalid = createGitLabFootprintClient({ baseUrl: 'http://private/', token, instance: value.instance, fetch: testFetch(async () => makeReply(value)) });
      await expect(invalid.observe(value.inventory)).rejects.toThrow();
    }
    for (const baseUrl of ['file:///tmp', 'http://user:secret@host/', 'http://host/path', 'http://host/?query'])
      expect(() => createGitLabFootprintClient({ baseUrl, token, instance: fixture().instance })).toThrow();
  });
  test('abort, request limits and changed configured roots stop the source before reading', async () => {
    const f = fixture(), serve = handler(f), controller = new AbortController(); controller.abort();
    expect((await serve(new Request('http://private/native/gitlab/footprint', { method: 'POST', body: JSON.stringify({ original: f.inventory }), headers: { authorization: 'Bearer ' + token }, signal: controller.signal }))).status).toBe(499);
    expect((await serve(new Request('http://private/native/gitlab/footprint', { method: 'POST', body: 'x'.repeat(8_388_609), headers: { authorization: 'Bearer ' + token } }))).status).toBe(503);
    f.inventory.roots[0]!.path = '/var/opt/gitlab/foreign';
    f.inventory.nativeRevision = jsonHash({ project: f.inventory.project, roots: f.inventory.roots, credentials: f.inventory.credentials, categories: f.inventory.categories, pipelines: f.inventory.pipelines });
    expect((await serve(new Request('http://private/native/gitlab/footprint', { method: 'POST', body: JSON.stringify({ original: f.inventory }), headers: { authorization: 'Bearer ' + token } }))).status).toBe(503);
    const source = fixture(), client = createGitLabFootprintClient({ baseUrl: 'http://private/', token, instance: { ...source.instance, epoch: 'e'.repeat(64) }, fetch: testFetch(async () => { throw Error('must not call'); }) });
    await expect(client.observe(source.inventory)).rejects.toThrow();
  });
});
