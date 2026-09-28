import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '../../../packages/testkit';
import { Store } from '../src/store';
import { LogStore, exportLogPage } from '../src/storageLog';
import { Objects, storageAction } from '../src/storage';
import { Platform, PlatformError } from '../src/client';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('object storage sample survives service replacement and keeps explicit log ranges', () => {
  let database: TestDatabase, store: Store;
  const fence = { epoch: 1, instanceId: 'instance', leaseId: 'lease' };
  beforeAll(async () => { database = await createTestDatabase(); store = new Store(database.url); await store.migrate(); await store.prepare(1, 'instance', 'active', new Date(Date.now() + 60_000).toISOString()); });
  afterAll(async () => { await store?.db.close(); await database?.drop(); });
  test('a failed upload replays the PG journal, not a newer page; cursors advance only after verified object pin', async () => {
    const logs = new LogStore(store), taskId = Bun.randomUUIDv7(), key = Bun.randomUUIDv7(); let reads = 0, payload = '';
    const platform = new Platform('http://platform', (async () => { reads++; return Response.json({ items: [{ cursor: 'one', type: 'output', data: { text: 'first' } }], nextCursor: 'one', hasMore: false }); }) as typeof fetch);
    const input = { taskId, requestKey: key, after: null };
    await expect(exportLogPage(platform, { persist: async () => { throw new Error('reply lost'); } }, logs, input, fence)).rejects.toThrow('reply lost');
    await expect(logs.finalManifest('finish', taskId, fence)).rejects.toThrow('尚未发布');
    const result = await exportLogPage(platform, { persist: async (_key, text) => { payload = text; return 'object-1'; } }, new LogStore(store), input, fence);
    expect(reads).toBe(1); expect(result).toMatchObject({ nextCursor: 'one', fullLog: false, state: 'captured-page' });
    expect(payload.split('\n').filter(Boolean).map((line) => JSON.parse(line))).toHaveLength(2);
    expect(JSON.parse(payload.split('\n')[0]!)).toMatchObject({ after: null, through: 'one', fullLog: false });
    await expect(exportLogPage(platform, { persist: async () => 'other' }, logs, { ...input, requestKey: 'wrong-next' }, fence)).rejects.toThrow('游标');
    const manifest = await logs.finalManifest('finish', taskId, fence); expect(manifest[1]).toMatchObject({ kind: 'object', objectId: 'object-1' });
    expect(await logs.finalManifest('finish', taskId, fence)).toEqual(manifest);
    await expect(logs.finalManifest('other', taskId, fence)).rejects.toThrow('已有终结');
  });
  test('410 and explicit gaps persist an incomplete range and never become a full-log declaration', async () => {
    for (const expired of [true, false]) {
      const platform = new Platform('http://platform', (async () => expired ? Response.json({}, { status: 410 }) : Response.json({ items: [{ cursor: 'gap', type: 'gap' }], nextCursor: 'gap', hasMore: false })) as typeof fetch);
      let payload = '';
      const result = await exportLogPage(platform, { persist: async (_key, text) => { payload = text; return 'partial'; } }, new LogStore(store), { taskId: Bun.randomUUIDv7(), requestKey: Bun.randomUUIDv7(), after: null }, fence);
      expect(result.state).toBe('export-incomplete'); expect(result.fullLog).toBe(false); expect(payload).toContain('export-incomplete');
    }
  });
  test('new policy and input objects are explicit; a lost plan-page reply keeps its original expected revision', async () => {
    const taskId = Bun.randomUUIDv7(), calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const platform = new Platform('http://platform', (async (url, options) => {
      const path = new URL(String(url)).pathname, body = JSON.parse(String(options?.body ?? '{}')); calls.push({ path, body });
      if (path.endsWith('/capabilities')) return Response.json({ storage: { finalization: true, taskInputs: true } });
      return Response.json({ id: taskId, generation: 1 });
    }) as typeof fetch);
    let plan = { id: 'plan', state: 'draft', revision: 1, digest: null as string | null }, lost = false;
    const pageInputs: unknown[] = [];
    const objects = new Objects('http://objects/v3/objects', (async (url, options) => {
      const path = new URL(String(url)).pathname, body = JSON.parse(String(options?.body ?? '{}'));
      if (path.endsWith('/pages')) { pageInputs.push(body); plan = { ...plan, revision: 2 }; if (!lost) { lost = true; throw new Error('page reply lost'); } }
      if (path.endsWith('/seal')) plan = { ...plan, state: 'sealed', revision: 3, digest: 'a'.repeat(64) };
      return Response.json(plan);
    }) as typeof fetch);
    const logs = new LogStore(store), inputObjects = [{ objectId: Bun.randomUUIDv7(), sha256: 'b'.repeat(64), path: 'input.txt' }];
    await storageAction(platform, objects, logs, { requestKey: 'start', action: 'storage-command', inputObjects }, fence);
    expect(calls.find((c) => c.path.endsWith('/business-tasks'))!.body).toMatchObject({ completionPolicy: 'archive-and-delete', volumeMode: 'persistent', inputObjects });
    const final = { action: 'storage-finalize', requestKey: 'finish', taskId, expectedGeneration: 1 };
    await expect(storageAction(platform, objects, logs, final, fence)).rejects.toThrow('page reply lost');
    await storageAction(platform, objects, logs, final, fence);
    expect(pageInputs[0]).toEqual(pageInputs[1]); expect(calls.at(-1)!.body.archive).toMatchObject({ planId: 'plan', planRevision: 3 });
    await expect(storageAction(platform, undefined, logs, final, fence)).rejects.toThrow('Manifest');
  });
  test('a lost PUT is observed through the upload handle; only a waiting upload can receive bytes', async () => {
    let state = 'waiting', puts = 0, pins = 0;
    const objects = new Objects('http://objects/v3/objects', (async (_url, options) => {
      if (options?.method === 'PUT' && new Headers(options.headers).has('x-cs-object-fence')) { puts++; state = 'uploading'; throw new Error('lost'); }
      if (options?.method === 'PUT') pins++;
      return Response.json({ id: 'upload', state, objectId: state === 'ready' ? 'object' : null });
    }) as typeof fetch);
    await expect(objects.persist('key', 'bytes', 'a'.repeat(64), 'task', fence)).rejects.toThrow('lost');
    await expect(objects.persist('key', 'bytes', 'a'.repeat(64), 'task', fence)).rejects.toBeInstanceOf(PlatformError); expect(puts).toBe(1);
    state = 'ready'; expect(await objects.persist('key', 'bytes', 'a'.repeat(64), 'task', fence)).toBe('object'); expect(pins).toBe(1);
    await objects.unpin('object', 'task', 'release', fence);
  });
});
