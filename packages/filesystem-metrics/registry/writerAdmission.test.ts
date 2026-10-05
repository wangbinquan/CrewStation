import { expect, test } from 'bun:test';
import { nativeRegistryWriterAdmission } from './writerAdmission';

const options = { baseUrl: 'http://native/', token: 'original-native-registry-token'.repeat(3), sourceIdentity: 'a'.repeat(64), journalIdentity: 'b'.repeat(64) };
const source = { version: 1 as const, identity: options.journalIdentity, sourceIdentity: options.sourceIdentity, complete: true as const, active: 0, total: 3 };
test('the pinned private source and idle acknowledgement preserve credentials, complete shape and original identity', async () => {
  const calls: string[] = [];
  const client = nativeRegistryWriterAdmission({ ...options, fetch: async (url, init) => {
    expect(init.headers).toMatchObject({ authorization: 'Bearer ' + options.token }); expect(init.redirect).toBe('error'); expect(init.signal).toBeInstanceOf(AbortSignal);
    calls.push(url.pathname);
    if (init.method === 'GET') return Response.json(source);
    expect(JSON.parse(String(init.body))).toEqual({ sourceIdentity: options.sourceIdentity, journalIdentity: options.journalIdentity });
    return new Response(null, { status: 204 });
  } });
  expect(await client.observe()).toEqual(source); await client.assertAvailable();
  expect(calls).toEqual(['/native/registry/source', '/native/registry/writer-admission']);
});
test('busy, redirected, unavailable and successful but unrecognized admission responses never release a producer', async () => {
  for (const status of [201, 302, 403, 409, 503]) {
    const client = nativeRegistryWriterAdmission({ ...options, fetch: async () => new Response('unavailable', { status }) });
    await expect(client.assertAvailable()).rejects.toThrow('not released');
    if (status !== 201) await expect(client.observe()).rejects.toThrow('unavailable');
  }
  const down = nativeRegistryWriterAdmission({ ...options, fetch: async () => { throw Error('original operator disconnected'); } });
  await expect(down.assertAvailable()).rejects.toThrow('disconnected');
});
test('a replacement, partial scan or inconsistent counters cannot supply the original native journal', async () => {
  for (const value of [{ ...source, identity: 'c'.repeat(64) }, { ...source, sourceIdentity: 'c'.repeat(64) }, { ...source, active: 4 }, { ...source, complete: false }]) {
    const client = nativeRegistryWriterAdmission({ ...options, fetch: async () => Response.json(value) });
    await expect(client.observe()).rejects.toThrow();
  }
  const empty = nativeRegistryWriterAdmission({ ...options, fetch: async () => new Response(null, { status: 204 }) });
  await expect(empty.observe()).rejects.toThrow('unavailable');
  const oversized = nativeRegistryWriterAdmission({ ...options, fetch: async () => new Response('x'.repeat(4097)) });
  await expect(oversized.observe()).rejects.toThrow('exceeded');
});
test('credential-bearing or partial deployment sources are rejected before any request', () => {
  for (const value of [{ ...options, token: '' }, { ...options, baseUrl: 'http://user:secret@native/' }, { ...options, baseUrl: 'http://native/path' }, { ...options, baseUrl: 'ftp://native/' }, { ...options, sourceIdentity: 'unknown' }]) {
    expect(() => nativeRegistryWriterAdmission(value)).toThrow();
  }
});
