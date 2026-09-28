import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ObjectUploadDto } from '@crewstation/contracts';
import { archiveClient } from './client';
import type { ArchiveClient } from './client';
import { executeArchive } from './execute';

const linux = process.platform === 'linux' && ['arm64', 'x64'].includes(process.arch);
test('archive metadata backpressure retries the same page and completes after HTTP 503 clears', async () => {
  const id = Bun.randomUUIDv7(); let attempts = 0, completed = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => {
    if (new URL(request.url).pathname.endsWith('/entries')) {
      if (++attempts === 1) return Response.json({ error: 'unavailable', details: { code: 'object_storage_busy' } }, { status: 503, headers: { 'retry-after': '1' } });
      return Response.json({ items: [], nextOffset: null });
    }
    completed++; return new Response(null, { status: 204 });
  } });
  try {
    const signal = AbortSignal.timeout(5000), client = archiveClient(`http://127.0.0.1:${server.port}/internal/archive-helpers/${id}`, 't'.repeat(43), signal, id);
    expect(await executeArchive(client, '/unused-no-file-entries', signal)).toBe(0);
    expect(attempts).toBe(2); expect(completed).toBe(1);
  } finally { await server.stop(true); }
});
test.skipIf(!linux)('the fixed helper streams a file, polls readback, records an optional absence, and completes the selected manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-archive-http-')), bytes = 'archive output\n'.repeat(10_000), grantId = Bun.randomUUIDv7(), token = 't'.repeat(43);
  await writeFile(join(root, 'result.txt'), bytes);
  const id = Bun.randomUUIDv7(), sha256 = createHash('sha256').update(bytes).digest('hex'), results: unknown[] = [];
  let transferred = '', declared = false, commits = 0, complete = false;
  let upload: ObjectUploadDto = { id, spaceId: Bun.randomUUIDv7(), size: Buffer.byteLength(bytes), state: 'waiting', receivedBytes: 0, objectId: null, operationId: null, errorCode: null, retryable: true, nextRetryAt: null, createdAt: new Date().toISOString() };
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async (request) => {
    if (request.headers.get('authorization') !== `Bearer ${token}` || request.headers.get('x-cs-archive-pod-uid') !== grantId) return new Response(null, { status: 403 });
    const path = new URL(request.url).pathname.replace(`/internal/archive-helpers/${grantId}`, '');
    if (path === '/entries') return Response.json({ items: [{ kind: 'file', path: 'result.txt', name: 'result', required: true }, { kind: 'file', path: 'missing', name: 'optional', required: false }], nextOffset: null });
    if (path === '/uploads') { const input = await request.json() as { path: string; size: number; sha256: string }; declared = input.path === 'result.txt' && input.size === Buffer.byteLength(bytes) && input.sha256 === sha256; return Response.json(upload, { status: declared ? 201 : 400 }); }
    if (path === `/uploads/${id}/content`) {
      transferred = await request.text();
      if (!declared || request.headers.get('content-length') !== String(Buffer.byteLength(bytes)) || createHash('sha256').update(transferred).digest('hex') !== sha256) return new Response(null, { status: 400 });
      upload = { ...upload, state: 'verifying', receivedBytes: Buffer.byteLength(transferred) }; return Response.json(upload, { status: 202 });
    }
    if (path === `/uploads/${id}/commit`) { commits += 1; upload = { ...upload, state: 'ready', objectId: id, retryable: false }; return Response.json(upload, { status: 202 }); }
    if (path === `/uploads/${id}`) return Response.json(upload);
    if (path === '/results') { results.push(await request.json()); return new Response(null, { status: 204 }); }
    if (path === '/complete') { complete = results.length === 2; return new Response(null, { status: complete ? 204 : 412 }); }
    return new Response(null, { status: 404 });
  } });
  try {
    const signal = AbortSignal.timeout(10_000), client = archiveClient(`http://127.0.0.1:${server.port}/internal/archive-helpers/${grantId}`, token, signal, grantId);
    expect(await executeArchive(client, root, signal)).toBe(2); expect(transferred).toBe(bytes); expect(commits).toBe(1); expect(complete).toBe(true);
    expect(results).toHaveLength(2); expect(results).toEqual(expect.arrayContaining([{ path: 'result.txt', objectId: id }, { path: 'missing', omitted: 'not-found' }]));
  } finally { await server.stop(true); await rm(root, { recursive: true, force: true }); }
}, 15_000);

test('archive protocol rejects oversized metadata and does not echo credential-bearing proxy errors', async () => {
  let mode = 'oversize';
  const token = 't'.repeat(43), id = Bun.randomUUIDv7();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => mode === 'oversize' ? Response.json({ items: ['x'.repeat(300_000)], nextOffset: null }) : new Response(`sensitive ${token}`, { status: 403 }) });
  try {
    const client = archiveClient(`http://127.0.0.1:${server.port}/internal/archive-helpers/${id}`, token, AbortSignal.timeout(10_000), id);
    await expect(client.entries(0)).rejects.toThrow('超出上限');
    mode = 'denied'; await expect(client.entries(0)).rejects.toThrow('HTTP 403');
    try { await client.entries(0); } catch (error) { expect(String(error)).not.toContain(token); }
  } finally { await server.stop(true); }
});

test.skipIf(!linux)('small-file batching bounds open work, waits for acknowledgements, and never completes a failed manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-archive-batch-')), names = Array.from({ length: 12 }, (_,i) => `file-${i}`);
  for (const name of names) await writeFile(join(root, name), name);
  try {
    for (const failing of [false, true]) {
      let active = 0, peak = 0, uploaded = 0, completed = 0;
      const results: string[] = [], failures: unknown[] = [];
      const client: ArchiveClient = {
        entries: async () => ({ items: names.map((path) => ({ kind: 'file' as const, path, name: path, required: true })), nextOffset: null }),
        upload: async (input) => {
          active++; uploaded++; peak = Math.max(peak, active);
          try {
            await Bun.sleep(20);
            if (failing && input.path === names[0]) throw new Error('backend unavailable');
            return { id: Bun.randomUUIDv7(), spaceId: Bun.randomUUIDv7(), size: input.size, state: 'ready', receivedBytes: input.size, objectId: Bun.randomUUIDv7(), operationId: null, errorCode: null, retryable: false, nextRetryAt: null, createdAt: new Date().toISOString() };
          } finally { active--; }
        },
        content: async () => { throw new Error('already ready'); }, status: async () => { throw new Error('already ready'); }, commit: async () => { throw new Error('already ready'); },
        result: async (input) => { await Bun.sleep(10); results.push(input.path); },
        fail: async (input) => { expect(active).toBe(0); failures.push(input); },
        complete: async () => { expect(results).toHaveLength(names.length); completed++; },
      };
      const execution = executeArchive(client, root, AbortSignal.timeout(5000));
      if (failing) { await expect(execution).rejects.toThrow('backend unavailable'); expect(completed).toBe(0); expect(uploaded).toBeLessThan(names.length); expect(failures).toHaveLength(1); }
      else { expect(await execution).toBe(names.length); expect(completed).toBe(1); expect(failures).toHaveLength(0); }
      expect(peak).toBeGreaterThan(1); expect(peak).toBeLessThanOrEqual(4); expect(active).toBe(0);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
