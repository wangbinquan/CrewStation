import { expect, test } from 'bun:test';
import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { consumerFixture } from './consumerFixture';
import { createFilesystemMetricsHandler } from './server';

const token = 'original-consumer-source-token-with-32-characters';
const source = { bootId: '12345678-1234-1234-1234-123456789abc', namespace: 'pid:[701]' };
const request = (body: unknown, authenticated = true, signal?: AbortSignal) => new Request('http://probe/consumers', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body), ...(signal ? { signal } : {}),
});

test('authenticated consumer HTTP captures the full visible source and observes original held files', () => consumerFixture(async (f) => {
  const process = await f.process('22'); await symlink(f.file, join(process, 'fd/7'));
  const handler = createFilesystemMetricsHandler({ token, roots: {}, procRoot: f.root });
  const input = { mode: 'capture', identities: [f.identity] };
  const denied = await handler(request(input, false)); expect(denied.status).toBe(401);
  const captured = await handler(request(input));
  // The reader existed but its authenticated HTTP endpoint returned 404, leaving cleanup unable to use it.
  expect(captured.status).toBe(200);
  const first = await captured.json(); expect(first.complete).toBe(true); expect(first.bootId).toBe(source.bootId); expect(first.namespace).toBe(source.namespace);
  expect(first.consumers).toEqual([{ pid: 22, tid: 22, startedTick: '311', kind: 'descriptor', ...f.identity }]);
  const observed = await handler(request({ mode: 'observe', source, identities: [f.identity] }));
  expect(await observed.json()).toEqual(first);
  for (const secret of ['private body', 'private process', f.file, f.root, token]) expect(JSON.stringify(first)).not.toContain(secret);
}));

test('a changed source, unreadable process and cancelled observation cannot return zero-consumer completion', () => consumerFixture(async (f) => {
  const process = await f.process('22'), handler = createFilesystemMetricsHandler({ token, roots: {}, procRoot: f.root });
  const changed = await handler(request({ mode: 'observe', source: { ...source, namespace: 'pid:[702]' }, identities: [f.identity] }));
  expect((await changed.json()).complete).toBe(false);
  await writeFile(join(process, 'maps'), 'unreadable mapping format');
  const unreadable = await handler(request({ mode: 'capture', identities: [f.identity] }));
  expect((await unreadable.json()).blockers).toEqual([{ code: 'process-unreadable', pid: 22 }]);
  const cancelled = await handler(request({ mode: 'capture', identities: [f.identity] }, true, AbortSignal.abort()));
  expect(cancelled.status).toBe(503); expect(await cancelled.json()).not.toHaveProperty('complete');
}));

test('consumer requests cannot choose another proc root or omit an original source during observe', () => consumerFixture(async (f) => {
  await f.process('22'); const handler = createFilesystemMetricsHandler({ token, roots: {}, procRoot: f.root });
  for (const input of [
    { mode: 'capture', identities: [f.identity], procRoot: '/secret' }, { mode: 'observe', identities: [f.identity] },
    { mode: 'capture', identities: [{ device: '-1', inode: '0' }] }, { mode: 'capture', identities: [f.identity, f.identity] },
    { mode: 'capture', identities: Array.from({ length: 257 }, (_, i) => ({ device: '1', inode: String(i + 1) })) },
  ]) expect((await handler(request(input))).status).toBe(400);
}));

test('the largest legal identity batch remains observable without trusting oversized or streaming request bodies', () => consumerFixture(async (f) => {
  await f.process('22'); const handler = createFilesystemMetricsHandler({ token, roots: {}, procRoot: f.root });
  const identities = Array.from({ length: 256 }, (_, index) => ({ device: '18446744073709551615', inode: String(18_446_744_073_709_551_615n - BigInt(index)) }));
  // uint64 identities are longer than the old 16 KiB measurement limit; a valid full batch must reach the reader.
  const observed = await handler(request({ mode: 'observe', source, identities }));
  expect(observed.status).toBe(200); expect((await observed.json()).complete).toBe(true);
  const large = await handler(new Request('http://probe/consumers', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-length': '32769' }, body: '{}' }));
  expect(large.status).toBe(413);
  expect((await handler(request({ padding: 'x'.repeat(32_769) }))).status).toBe(400);
}));
