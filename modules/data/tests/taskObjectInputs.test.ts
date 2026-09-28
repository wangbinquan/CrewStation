import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { TaskIdSchema, TaskInputObjectsSchema } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { dataMigrations } from '../wiring';
import { taskInputRepository, releaseTaskInputs } from '../adapters/persistence/objects/taskInputs';
import { objectStorageTransaction } from '../adapters/persistence/objectCatalog';
import { taskInputUseCases } from '../application/objects/taskInputs';
import { taskInputRoutes } from '../http/taskInputRoutes';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectId } from './objectFixtures';
import type { ObjectBackendPlane } from '../ports/objectStorage';

test('task inputs require unique non-overlapping safe paths and immutable digests', () => {
  const item = { objectId: objectId(), sha256: 'a'.repeat(64), path: 'plugins/p.bin' };
  expect(TaskInputObjectsSchema.safeParse([item]).success).toBe(true);
  for (const paths of [['a', 'a'], ['a', 'a-b', 'a/b'], ['../x'], ['/absolute'], ['.crewstation/secret']]) expect(TaskInputObjectsSchema.safeParse(paths.map((path) => ({ ...item, path }))).success).toBe(false);
});
const available = await testDatabaseAvailable();
describe.skipIf(!available)('platform task input pins and Pod scoped download grants', () => {
  let tdb: TestDatabase;
  beforeEach(async () => { tdb = await createTestDatabase([dataMigrations]); });
  afterEach(async () => { await tdb?.drop(); });
  async function fixture() {
    const f = await objectArchiveFixture(tdb.db), inputs = taskInputRepository(tdb.db);
    const prepared = { taskId: TaskIdSchema.parse(f.taskId), projectId: f.source.projectId, serviceId: f.source.serviceId, generation: 1, items: [{ objectId: f.object.id, sha256: f.object.sha256, path: 'plugins/bundle.bin' }] };
    return { ...f, inputs, prepared };
  }
  test('prepare fixes the full set, blocks deletion, survives admission uncertainty and releases only on proven reclaim', async () => {
    const f = await fixture(); await f.inputs.prepare(f.prepared); await f.inputs.prepare(f.prepared);
    expect((await f.reads.object(f.object.id))?.referenceCount).toBe(1);
    await expect(f.inputs.prepare({ ...f.prepared, items: [{ ...f.prepared.items[0]!, path: 'changed' }] })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.content.delete(f.object.id, { requestKey: objectId(), expectedRevision: 2 }, f.authority)).rejects.toThrow('引用');
    await f.inputs.commit(f.prepared.taskId, 1); await f.inputs.commit(f.prepared.taskId, 1);
    await expect(f.inputs.abort(f.prepared.taskId, 1, false)).rejects.toThrow('已准入');
    await objectStorageTransaction(tdb.db, (tx, now) => releaseTaskInputs(tx, f.prepared.taskId, now));
    expect((await f.reads.object(f.object.id))?.referenceCount).toBe(0);
    await expect(f.inputs.prepare(f.prepared)).rejects.toThrow('永久关闭');
  });
  test('a proven retryable admission rejection releases unused pins; retry uses a new reference version with the same input set', async () => {
    const f = await fixture(); await f.inputs.prepare(f.prepared); await f.inputs.abort(f.prepared.taskId, 1, true);
    expect((await f.reads.object(f.object.id))?.referenceCount).toBe(0);
    await f.inputs.prepare(f.prepared); expect((await f.reads.object(f.object.id))?.referenceCount).toBe(1);
    await f.inputs.abort(f.prepared.taskId, 1, false); await expect(f.inputs.prepare(f.prepared)).rejects.toThrow('永久关闭');
    const other = await fixture(); await expect(other.inputs.prepare({ ...other.prepared, items: [{ ...other.prepared.items[0]!, sha256: 'b'.repeat(64) }] })).rejects.toThrow('摘要');
    await expect(other.inputs.prepare({ ...other.prepared, items: f.prepared.items })).rejects.toThrow('不存在');
    expect((await other.reads.object(other.object.id))?.referenceCount).toBe(0);
  });
  test('grant cannot be used before exact Pod binding, on another Pod, for a different object, or after completion/expiry', async () => {
    const f = await fixture(); await f.inputs.prepare(f.prepared);
    let reads = 0;
    const plane = { get: async () => { reads++; throw new Error('read attempted'); } } as unknown as ObjectBackendPlane;
    const api = taskInputUseCases({ inputs: f.inputs, content: f.content, plane, owner: objectId(), secretKeyBase64: Buffer.alloc(32, 3).toString('base64'), apiUrl: 'http://api.internal:8087' });
    const consumerId = objectId(), env = await api.environment({ taskId: f.prepared.taskId, generation: 1, consumerId }), podUid = crypto.randomUUID();
    expect(await api.environment({ taskId: f.prepared.taskId, generation: 1, consumerId })).toEqual(env);
    const caller = { id: consumerId, token: env.CS_OBJECT_INPUT_TOKEN!, podUid };
    await expect(api.manifest(caller)).rejects.toMatchObject({ kind: 'forbidden' });
    await api.bind(consumerId, podUid); await api.bind(consumerId, podUid);
    await expect(api.bind(consumerId, crypto.randomUUID())).rejects.toThrow('其他 Pod');
    expect(await api.manifest(caller)).toEqual({ completed: false, items: [{ ...f.prepared.items[0]!, size: 100 }] });
    await expect(api.manifest({ ...caller, podUid: crypto.randomUUID() })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(api.download(caller, objectId(), new AbortController().signal)).rejects.toMatchObject({ kind: 'not_found' }); expect(reads).toBe(0);
    const app = createApp({ name: 'input-test' }).route('/', taskInputRoutes(api));
    expect((await app.request(`/internal/task-inputs/${consumerId}`)).status).toBe(403);
    const headers = { authorization: `Bearer ${caller.token}`, 'x-cs-input-pod-uid': podUid };
    expect((await app.request(`/internal/task-inputs/${consumerId}`, { headers })).status).toBe(200);
    await api.complete(caller); await api.complete(caller);
    expect(await api.manifest(caller)).toEqual({ completed: true, items: [] });
    await expect(api.download(caller, f.object.id, new AbortController().signal)).rejects.toThrow('不存在');
    await tdb.db.execute(sql`UPDATE data.task_input_grants SET body=jsonb_set(body,'{expiresAt}',to_jsonb('2020-01-01T00:00:00Z'::text)) WHERE id=${consumerId}`);
    await expect(api.manifest(caller)).rejects.toMatchObject({ kind: 'forbidden' });
  });
});
