import { expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createGarageInventoryClient } from './client';
import { createFilesystemMetricsHandler } from '../server';
import { garageMetadataFixture } from './fixture';
import type { GarageInventoryRequest } from './protocol';

const token = 'original-native-source-token-1234567890';
test('private HTTP and actual SQLite/disk inventory retain old multipart and shared references with no mutation or completion claim', async () => {
  const f = await garageMetadataFixture();
  try {
    const directory = 'data'; await mkdir(join(f.root, directory, 'old'), { recursive: true });
    const name = f.block.toString('hex') + '.zst'; await writeFile(join(f.root, directory, 'old', name), 'keep-original-copy');
    f.insert('version', { uuid: f.original, deleted: false, backlink: { Object: { bucket_id: f.bucket, key: `spaces/${f.space}/attempts/old` } }, blocks: [[{ part_number: 1, offset: 0 }, { hash: f.block, size: 3 }]] });
    f.insert('block_ref', { block: f.block, version: f.foreign, deleted: false });
    const handler = createFilesystemMetricsHandler({ roots: { local: f.root }, token });
    const fetcher = async (url: URL, init: RequestInit) => handler(new Request(url, init));
    const client = createGarageInventoryClient({ baseUrl: 'http://probe.invalid', token, fetch: fetcher });
    const request: GarageInventoryRequest = { key: 'original', rootId: 'local', metadataDirectory: f.directory, dataDirectory: directory, query: f.query };
    const before = await readFile(f.file), result = await client.observe(request);
    expect(result.blocks.copies).toHaveLength(1); expect(result.metadata.references).toEqual([{ block: f.block.toString('hex'), version: f.foreign.toString('hex'), deleted: false, owned: false }]);
    expect(result.metadata.physicalReclamationProven).toBe(false); expect(result.metadata.producersClosed).toBe(false);
    expect(await readFile(f.file)).toEqual(before); expect(await readFile(join(f.root, directory, 'old', name), 'utf8')).toBe('keep-original-copy');
    expect((await handler(new Request('http://probe.invalid/garage/inventory', { method: 'POST' }))).status).toBe(401);
    expect((await handler(new Request('http://probe.invalid/garage/inventory', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-length': String(25 * 1024 * 1024) } }))).status).toBe(413);
    const canceled = new AbortController(); canceled.abort(); await expect(client.observe(request, canceled.signal)).rejects.toThrow();
    const damaged = createGarageInventoryClient({ baseUrl: 'http://probe.invalid', token, fetch: async (url, init) => {
      const output = await (await fetcher(url, init)).json() as typeof result; output.blocks.copies[0]!.identity = 'aa'.repeat(32); return Response.json(output);
    } });
    await expect(damaged.observe(request)).rejects.toThrow('copy-conflict');
    const substituted = createGarageInventoryClient({ baseUrl: 'http://probe.invalid', token, fetch: async (url, init) => {
      const output = await (await fetcher(url, init)).json() as typeof result; output.requestIdentity = 'aa'.repeat(32); return Response.json(output);
    } });
    await expect(substituted.observe(request)).rejects.toThrow('scope-conflict');
  } finally { await f.dispose(); }
});
test('client rejects successful but absent or oversized native replies and read-only route rejects unrecognized roots', async () => {
  const f = await garageMetadataFixture();
  try {
    const request: GarageInventoryRequest = { key: 'original', rootId: 'unknown', metadataDirectory: f.directory, dataDirectory: 'data', query: f.query };
    const handler = createFilesystemMetricsHandler({ roots: { local: f.root }, token });
    const response = await handler(new Request('http://probe.invalid/garage/inventory', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify(request) }));
    expect(response.status).toBe(400);
    for (const output of [new Response(null), new Response('{}', { headers: { 'content-length': String(33 * 1024 * 1024) } })]) {
      const client = createGarageInventoryClient({ baseUrl: 'http://probe.invalid', token, fetch: async () => output });
      await expect(client.observe(request)).rejects.toThrow('reply-budget');
    }
  } finally { await f.dispose(); }
});
