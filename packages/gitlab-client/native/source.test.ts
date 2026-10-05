import { describe, test, expect } from 'bun:test';
import { createGitLabNativeClient, parseGitLabNativeOutput } from './client';
import { createGitLabNativeHandler } from './server';
import { GitLabNativeInventorySchema } from './protocol';
import { nativeFixture, reviseNative } from './fixture';

const token = 'native-private-test-token'.padEnd(48, '0');
const output = (value: unknown) => 'CS_GITLAB_NATIVE=' + JSON.stringify(value);
function setup() {
  const f = nativeFixture(), calls: unknown[] = [];
  const observer = { inspect: async () => ({ ...f.instance }), read: async (query: unknown) => { calls.push(query); return output(f.inventory); } };
  const handler = createGitLabNativeHandler({ token, instance: f.instance, observer });
  const client = createGitLabNativeClient({ baseUrl: 'http://native.test', token, instance: f.instance, fetch: (async (url, init) => handler(new Request(String(url), init))) as typeof fetch });
  return { ...f, calls, observer, handler, client };
}
describe('original GitLab private metadata source; no erasure proof', () => {
  test('actual handler and SDK keep all eleven categories, shared references and uint64 epochs', async () => {
    const f = setup(), result = await f.client.observe(f.request);
    expect(result.inventory.categories).toHaveLength(11); expect(result.inventory.roots).toHaveLength(7);
    expect(result.inventory.roots[0]!.identity!.inode).toBe('18446744073709551615');
    expect(result.inventory.categories.find(row => row.kind === 'lfs')!.objects[0]).toMatchObject({ projectIds: ['383', '384'] });
    expect(result.inventory).toMatchObject({ readonly: true, producersClosed: false, consumersStopped: false, physicalReclamationProven: false });
    expect(f.calls).toEqual([f.request]);
  });
  test('the native facts digest is checked and empty categories still require explicit complete coverage', () => {
    const f = setup(); expect(parseGitLabNativeOutput(output(f.inventory), f.request).nativeRevision).toBe(f.inventory.nativeRevision);
    for (const change of ['missing', 'duplicate', 'wrong model', 'unknown key', 'true proof', 'changed fact', 'out of volume', 'overflow']) {
      const value = structuredClone(f.inventory);
      if (change === 'missing') value.categories.pop();
      if (change === 'duplicate') value.categories[10] = structuredClone(value.categories[0]!);
      if (change === 'wrong model') value.categories[5]!.objects.push(structuredClone(value.categories[4]!.objects[0]!));
      if (change === 'unknown key') (value.credentials.tokens[0] as unknown as Record<string, unknown>)['token'] = 'private-secret-must-not-pass';
      if (change === 'true proof') (value as unknown as Record<string, unknown>)['physicalReclamationProven'] = true;
      if (change === 'changed fact') value.credentials.tokens[0]!.revoked = false;
      if (change === 'out of volume') value.roots[0]!.path = '/other/project';
      if (change === 'overflow') value.roots[0]!.identity!.inode = '18446744073709551616';
      if (change !== 'changed fact') reviseNative(value);
      expect(() => GitLabNativeInventorySchema.parse(value)).toThrow();
    }
  });
  test('a substituted native instance or namespace is never queried as the original', async () => {
    for (const change of ['id', 'image', 'birth', 'namespace']) {
      const f = setup();
      if (change === 'id') f.instance.id = 'c'.repeat(64);
      if (change === 'image') f.instance.image = 'sha256:' + 'c'.repeat(64);
      if (change === 'birth') f.instance.startedAt = '2026-10-01T00:00:00Z';
      if (change === 'namespace') f.inventory.runtime.namespace = 'pid:[18]';
      await expect(f.client.observe(f.request)).rejects.toThrow();
      if (change !== 'namespace') expect(f.calls).toHaveLength(0);
    }
  });
  test('foreign project, birth or missing original token cannot replace the request', async () => {
    for (const change of ['project', 'path', 'birth', 'token']) {
      const f = setup();
      if (change === 'project') f.inventory.project.id = '384';
      if (change === 'path') f.inventory.project.pathWithNamespace = 'group/foreign';
      if (change === 'birth') f.inventory.project.createdAt = '2026-10-01T00:00:00Z';
      if (change === 'token') f.inventory.credentials.tokens = [];
      reviseNative(f.inventory); await expect(f.client.observe(f.request)).rejects.toThrow();
    }
  });
  test('mutating the caller scope while the source is paused leaves the original request intact', async () => {
    const f = setup(); let resume!: () => void, entered!: () => void;
    const pause = new Promise<void>(resolve => { resume = resolve; }), reading = new Promise<void>(resolve => { entered = resolve; });
    f.observer.read = async query => { f.calls.push(query); entered(); await pause; return output(f.inventory); };
    const pending = f.client.observe(f.request); await reading;
    f.request.projectId = '384'; f.request.tokenIds[0] = '999'; resume();
    expect((await pending).inventory.project.id).toBe('383'); expect(f.calls[0]).toMatchObject({ projectId: '383', tokenIds: ['513'] });
  });
  test('source loss, stale receipt, malformed UTF8 and invalid or oversized envelopes fail closed', async () => {
    for (const mode of ['offline', 'stale', 'source after', 'utf8', 'large', 'invalid']) {
      const f = setup(); const fetcher = (async (_input: Parameters<typeof fetch>[0]) => {
        if (mode === 'offline') return new Response(null, { status: 503 });
        if (mode === 'utf8') return new Response(new Uint8Array([0xff]));
        if (mode === 'large') return new Response('x'.repeat(8_388_609));
        if (mode === 'invalid') return new Response('{}');
        if (mode === 'stale') f.inventory.observedAt = '2000-01-01T00:00:00Z';
        return Response.json({ before: f.instance, after: mode === 'source after' ? { ...f.instance, id: 'c'.repeat(64) } : f.instance, inventory: f.inventory });
      }) as typeof fetch;
      await expect(createGitLabNativeClient({ baseUrl: 'http://native.test', token, instance: f.instance, fetch: fetcher }).observe(f.request)).rejects.toThrow();
    }
    const f = setup(); for (const raw of ['', '{}', output(f.inventory) + '\n' + output(f.inventory), 'x'.repeat(8_388_609)]) expect(() => parseGitLabNativeOutput(raw, f.request)).toThrow();
  });
  test('authentication, request budgets, busy state and cancellation cannot produce completion', async () => {
    const f = setup(), make = (body: string, authorization = 'Bearer ' + token, signal?: AbortSignal) => new Request('http://native.test/native/gitlab/inventory', { method: 'POST', headers: { authorization }, body, signal });
    expect((await f.handler(make(JSON.stringify(f.request), 'wrong'))).status).toBe(401);
    expect((await f.handler(make('x'.repeat(32_769)))).status).toBe(503);
    expect((await f.handler(make('{}'))).status).toBe(503);
    expect((await f.handler(new Request('http://native.test/unknown'))).status).toBe(404);
    expect((await f.handler(new Request('http://native.test/native/gitlab/inventory'))).status).toBe(405);
    let resume!: () => void, entered!: () => void;
    const pause = new Promise<void>(resolve => { resume = resolve; }), reading = new Promise<void>(resolve => { entered = resolve; });
    f.observer.read = async () => { entered(); await pause; return output(f.inventory); };
    const abort = new AbortController(), pending = f.handler(make(JSON.stringify(f.request), 'Bearer ' + token, abort.signal));
    await reading; abort.abort(); expect((await f.handler(make(JSON.stringify(f.request)))).status).toBe(409);
    resume(); expect((await pending).status).toBe(499);
    expect(() => createGitLabNativeHandler({ token: 'short', instance: f.instance, observer: f.observer })).toThrow();
    expect(() => createGitLabNativeClient({ baseUrl: 'http://user:secret@native.test', token, instance: f.instance })).toThrow();
    expect(() => createGitLabNativeClient({ baseUrl: 'http://native.test/path', token, instance: f.instance })).toThrow();
    expect(() => createGitLabNativeClient({ baseUrl: 'http://native.test', token: 'short', instance: f.instance })).toThrow();
    await expect(f.client.observe({ ...f.request, tokenIds: ['513', '513'] })).rejects.toThrow();
    await expect(f.client.observe({ ...f.request, tokenIds: Array.from({ length: 10_000 }, (_, i) => String(10_000 + i)) })).rejects.toThrow();
  });
});
