import { describe, expect, test } from 'bun:test';
import { jsonHash } from '@crewstation/kernel';
import { storageFixture, reviseStorage } from './fixture';
import { createGitLabStorageRemovalClient, GitLabStorageRemovalRequestSchema, parseGitLabStorageRemovalOutput } from './removal';
import type { GitLabStorageRemovalReceipt } from './removal';
import { createGitLabStorageRemovalHandler } from './removalServer';

const token = 'removal-private-token'.padEnd(48, '0');
const output = (receipt: unknown) => 'CS_GITLAB_REMOVAL=' + JSON.stringify(receipt);
function setup() {
  const f = storageFixture(), calls: string[] = [];
  const locations = f.inventory.locations.map(({ key, root, relative, mode }) => ({ key, root, relative, mode }));
  const facts = { originalRevision: f.inventory.revision,
    remainingRevision: jsonHash({ roots: f.roots, locations: locations.map(row => ({ ...row, present: false, entries: [] })) }),
    removedEntries: 3, locations, roots: structuredClone(f.roots) };
  const receipt: GitLabStorageRemovalReceipt = { ...facts, version: 1, observedAt: new Date().toISOString(), revision: jsonHash(facts), runtime: structuredClone(f.inventory.runtime),
    physicalReclamationProven: false, producersClosed: false, consumersStopped: false };
  const observer = { inspect: async () => { calls.push('inspect'); return { ...f.instance }; },
    remove: async (_raw: unknown) => { calls.push('remove'); return output(receipt); } };
  const guards = { grant: async (_raw: unknown) => { calls.push('grant'); }, stopped: async (_raw: unknown) => { calls.push('stopped'); } };
  const handler = createGitLabStorageRemovalHandler({ token, instance: f.instance, observer, assertGrant: raw => guards.grant(raw), assertStopped: raw => guards.stopped(raw) });
  const client = createGitLabStorageRemovalClient({ token, baseUrl: 'http://native.test', instance: f.instance,
    fetch: (async (url, init) => handler(new Request(String(url), init))) as typeof fetch });
  return { ...f, calls, receipt, observer, guards, handler, client };
}
describe('native retained file removal protocol', () => {
  test('native mutation follows both grant and independent stop checks, and returned absence is bound to every captured path', async () => {
    const f = setup(), result = await f.client.remove(f.inventory);
    expect(f.calls).toEqual(['inspect', 'grant', 'stopped', 'remove', 'inspect']);
    expect(result.receipt.removedEntries).toBe(3); expect(result.receipt.originalRevision).toBe(f.inventory.revision);
    expect(result.receipt).toMatchObject({ physicalReclamationProven: false, producersClosed: false, consumersStopped: false });
    f.receipt.removedEntries = 0; revise(f.receipt);
    expect((await f.client.remove(f.inventory)).receipt.removedEntries).toBe(0);
  });
  test('denied grants, unclosed consumers and changed scope or original instance execute no unlink', async () => {
    for (const mode of ['grant', 'stopped', 'scope', 'instance', 'captured namespace']) {
      const f = setup();
      if (mode === 'grant') f.guards.grant = async () => { throw Error('grant rejected'); };
      if (mode === 'stopped') f.guards.stopped = async () => { throw Error('consumer in flight'); };
      if (mode === 'scope') f.guards.grant = async raw => { (raw as { original: typeof f.inventory }).original.locations[0]!.relative = 'foreign.git'; };
      if (mode === 'instance') f.observer.inspect = async () => ({ ...f.instance, id: 'c'.repeat(64) });
      if (mode === 'captured namespace') f.inventory.runtime.namespace = 'pid:[18]';
      await expect(f.client.remove(f.inventory)).rejects.toThrow(); expect(f.calls).not.toContain('remove');
    }
  });
  test('overlap, traversal, substituted roots or residual evidence cannot become successful erasure', () => {
    const f = setup();
    for (const mode of ['overlap', 'path']) {
      const original = structuredClone(f.inventory);
      if (mode === 'overlap') original.locations.push({ ...structuredClone(original.locations[0]!), key: 'overlap' });
      if (mode === 'path') original.locations[0]!.relative = '../foreign';
      reviseStorage(original); expect(() => GitLabStorageRemovalRequestSchema.parse({ original })).toThrow();
    }
    for (const mode of ['root', 'location', 'count', 'original', 'residual', 'proof', 'digest']) {
      const receipt = structuredClone(f.receipt);
      if (mode === 'root') receipt.roots[0]!.identity!.birthtimeNs = '1';
      if (mode === 'location') receipt.locations[0]!.relative = 'foreign.git';
      if (mode === 'count') receipt.removedEntries = 4;
      if (mode === 'original') receipt.originalRevision = 'c'.repeat(64);
      if (mode === 'residual') receipt.remainingRevision = f.inventory.revision;
      if (mode === 'proof') (receipt as unknown as Record<string, unknown>)['physicalReclamationProven'] = true;
      if (mode === 'digest') receipt.revision = 'c'.repeat(64); else revise(receipt);
      expect(() => parseGitLabStorageRemovalOutput(output(receipt), { original: f.inventory })).toThrow();
    }
  });
  test('caller changes during native erasure cannot alter the frozen original identity or file scope', async () => {
    const f = setup(); let entered!: () => void, resume!: () => void;
    const begun = new Promise<void>(resolve => { entered = resolve; }), pause = new Promise<void>(resolve => { resume = resolve; });
    f.observer.remove = async () => { entered(); await pause; return output(f.receipt); };
    const pending = f.client.remove(f.inventory); await begun; f.inventory.locations[0]!.relative = 'foreign.git'; f.roots[0]!.path = '/var/opt/gitlab/foreign'; resume();
    expect((await pending).receipt.locations[0]!.relative).toBe('@hashed/original.git');
  });
  test('source replacement after unlink and stale, wrong namespace or malformed transport fail closed', async () => {
    for (const mode of ['after', 'stale', 'namespace', 'offline', 'empty', 'utf8', 'invalid', 'oversize']) {
      const f = setup(); let inspected = 0;
      if (mode === 'after') f.observer.inspect = async () => ({ ...f.instance, ...(++inspected === 2 ? { id: 'c'.repeat(64) } : {}) });
      if (mode === 'stale') f.receipt.observedAt = '2000-01-01T00:00:00Z';
      if (mode === 'namespace') f.receipt.runtime.namespace = 'pid:[18]';
      const fetcher = ['offline', 'empty', 'utf8', 'invalid', 'oversize'].includes(mode) ? (async (_input: Parameters<typeof fetch>[0]) =>
        mode === 'offline' ? new Response(null, { status: 503 }) : new Response(mode === 'empty' ? null : mode === 'utf8' ? new Uint8Array([255]) : mode === 'invalid' ? '{}' : 'x'.repeat(8_388_609))) as typeof fetch : undefined;
      const client = fetcher ? createGitLabStorageRemovalClient({ token, baseUrl: 'http://native.test', instance: f.instance, fetch: fetcher }) : f.client;
      await expect(client.remove(f.inventory)).rejects.toThrow();
    }
  });
  test('private mutation endpoint authenticates, serializes and rejects aborted or oversized requests', async () => {
    const f = setup(), make = (body = JSON.stringify({ original: f.inventory }), auth = token, path = '/native/gitlab/storage/remove', method = 'POST', signal?: AbortSignal) =>
      new Request('http://native.test' + path, { method, headers: { authorization: 'Bearer ' + auth }, ...(method === 'GET' ? {} : { body }), ...(signal ? { signal } : {}) });
    expect((await f.handler(make('', token, '/wrong'))).status).toBe(404);
    expect((await f.handler(make('', token, undefined, 'GET'))).status).toBe(405);
    expect((await f.handler(make('', 'bad'))).status).toBe(401);
    expect((await f.handler(make('{}'))).status).toBe(503);
    expect((await f.handler(make('x'.repeat(8_388_609)))).status).toBe(503);
    expect((await f.handler(make('', token, undefined, 'POST', AbortSignal.abort()))).status).toBe(499);
    let entered!: () => void, resume!: () => void;
    const begun = new Promise<void>(resolve => { entered = resolve; }), pause = new Promise<void>(resolve => { resume = resolve; });
    f.guards.stopped = async () => { entered(); await pause; };
    const pending = f.handler(make()); await begun; expect((await f.handler(make())).status).toBe(409); resume();
    expect((await pending).status).toBe(200);
  });
  test('bad endpoint configuration and non-native output formats never permit file reclamation', () => {
    const f = setup();
    for (const baseUrl of ['ftp://native.test', 'http://user:pass@native.test', 'http://native.test/path', 'http://native.test?query', 'http://native.test#hash'])
      expect(() => createGitLabStorageRemovalClient({ token, baseUrl, instance: f.instance })).toThrow();
    expect(() => createGitLabStorageRemovalClient({ token: 'short', baseUrl: 'http://native.test', instance: f.instance })).toThrow();
    expect(() => createGitLabStorageRemovalHandler({ token: 'short', instance: f.instance, observer: f.observer, assertGrant: async () => {}, assertStopped: async () => {} })).toThrow();
    for (const text of ['{}', output(f.receipt) + '\nother output', 'x'.repeat(8_388_609)])
      expect(() => parseGitLabStorageRemovalOutput(text, { original: f.inventory })).toThrow();
  });
});
function revise(receipt: GitLabStorageRemovalReceipt) {
  receipt.revision = jsonHash({ originalRevision: receipt.originalRevision, remainingRevision: receipt.remainingRevision,
    removedEntries: receipt.removedEntries, locations: receipt.locations, roots: receipt.roots });
}
