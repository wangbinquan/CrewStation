import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { BusinessMaterialDto, TaskId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionCommandFixture } from './executionCommandFixture';
import { assertMaterialUsable, drizzleExecutionMaterials } from '../adapters/persistence/materials/repository';
import type { ExecutionMaterialObjects } from '../ports/executionMaterials';

// RFC-040 V12: every execution used to add permanent material-version pins, so the business
// owner (AW plugin/skill cleanup) could never delete those objects. Pins are now released after
// the parent closes or once no attempt has used the material for the business retention period.
const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-040 material object pin release', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  async function fixture() {
    const f = await executionCommandFixture(tdb.db), path = `/v3/business-tasks/${f.task.id}/materials`;
    const calls = { pins: [] as number[], releases: [] as number[], failRelease: 0 };
    const materialObjects: ExecutionMaterialObjects = {
      pin: async (_caller, scope) => { calls.pins.push(scope.revision ?? 1); }, check: async () => {}, grants: async () => [],
      release: async (scope) => { calls.releases.push(scope.revision); if (calls.failRelease > 0) { calls.failRelease--; throw new Error('object storage busy'); } },
    };
    const api = f.make({ materialObjects }), store = drizzleExecutionMaterials(tdb.db);
    const object = { objectId: newResourceId(), sha256: 'b'.repeat(64), size: 3 }, input = { requestKey: newResourceId(), fence: f.fence, skills: [{ path: 'review/data.bin', object }] };
    const create = async (body = input) => { const response = await api.request(path, body); expect(response.status).toBe(201); return response.json() as Promise<BusinessMaterialDto>; };
    const state = async (id: string) => (await tdb.db.execute<{ state: string; pin_revision: number; object_count: number | null }>(sql`SELECT state, pin_revision, object_count FROM business_task.execution_materials WHERE id=${id}`))[0]!;
    const age = (id: string) => tdb.db.execute(sql`UPDATE business_task.execution_materials SET pinned_at=clock_timestamp()-interval '8 days' WHERE id=${id}`);
    const sweep = () => api.module.api.v3.runOnce();
    return { ...f, api, path, store, input, object, calls, create, state, age, sweep };
  }
  test('a fresh or retained material keeps its pins; after the retention one release happens and the same key revives a new revision', async () => {
    const f = await fixture(), material = await f.create();
    expect(f.calls.pins).toEqual([1]); await f.sweep(); expect(f.calls.releases).toEqual([]);
    await f.age(material.materialId); await f.sweep(); await f.sweep();
    expect(f.calls.releases).toEqual([1]); expect(await f.state(material.materialId)).toMatchObject({ state: 'released', pin_revision: 1, object_count: 1 });
    await expect(tdb.db.transaction((tx) => assertMaterialUsable(tx, material.materialId))).rejects.toMatchObject({ details: { code: 'material_released' } });
    expect((await f.store.get(f.serviceId, f.task.id as TaskId, material.materialId))?.state).toBe('released');
    const revived = await f.create();
    expect(revived).toEqual(material); expect(f.calls.pins).toEqual([1, 2]);
    expect(await f.state(material.materialId)).toMatchObject({ state: 'ready', pin_revision: 2 });
    await tdb.db.transaction((tx) => assertMaterialUsable(tx, material.materialId));
    await f.sweep(); expect(f.calls.releases).toEqual([1]);
  });
  test('a live or recently ended attempt keeps the material pinned; an interrupted release is repeated before it completes', async () => {
    const f = await fixture(), material = await f.create(), attempt = newResourceId();
    await tdb.db.execute(sql`INSERT INTO business_task.execution_subtasks(id,service_id,task_id,request_key,request_digest,sealed_payload,payload_digest,fenced,view,dispatch,updated_at)
      VALUES(${attempt},${f.serviceId},${f.task.id},${newResourceId()},${'c'.repeat(64)},'sealed',${'d'.repeat(64)},true,${JSON.stringify({ state: 'running', materialDigest: material.digest })}::text::jsonb,'failed',clock_timestamp())`);
    await f.age(material.materialId); await f.sweep(); expect(f.calls.releases).toEqual([]);
    await tdb.db.execute(sql`UPDATE business_task.execution_subtasks SET view=jsonb_set(view,'{state}','"succeeded"') WHERE id=${attempt}`);
    await f.sweep(); expect(f.calls.releases).toEqual([]);
    await tdb.db.execute(sql`UPDATE business_task.execution_subtasks SET updated_at=clock_timestamp()-interval '8 days' WHERE id=${attempt}`);
    f.calls.failRelease = 1; await f.sweep();
    expect(await f.state(material.materialId)).toMatchObject({ state: 'releasing' });
    await f.sweep(); expect(f.calls.releases).toEqual([1, 1]); expect(await f.state(material.materialId)).toMatchObject({ state: 'released' });
  });
  test('a closed parent releases its material pins without waiting for the retention', async () => {
    const f = await fixture(), material = await f.create();
    await tdb.db.execute(sql`INSERT INTO business_task.execution_task_states(task_id,service_id,generation,state) VALUES(${f.task.id},${f.serviceId},1,'closed') ON CONFLICT(task_id) DO UPDATE SET state='closed'`);
    await f.sweep(); expect(f.calls.releases).toEqual([1]); expect(await f.state(material.materialId)).toMatchObject({ state: 'released' });
  });
  test('a row admitted before pin tracking falls back to its creation time and records its object count once', async () => {
    const f = await fixture(), material = await f.create();
    await tdb.db.execute(sql`UPDATE business_task.execution_materials SET object_count=NULL, pinned_at=NULL WHERE id=${material.materialId}`);
    await f.sweep(); expect(f.calls.releases).toEqual([]); expect(await f.state(material.materialId)).toMatchObject({ state: 'ready', object_count: null });
    await tdb.db.execute(sql`UPDATE business_task.execution_materials SET created_at=clock_timestamp()-interval '8 days' WHERE id=${material.materialId}`);
    await f.sweep(); expect(f.calls.releases).toEqual([1]); expect(await f.state(material.materialId)).toMatchObject({ state: 'released', pin_revision: 1, object_count: 1 });
  });
  test('materials without objects are never released, including rows admitted before pin tracking', async () => {
    const f = await fixture(), response = await f.api.request(f.path, { requestKey: newResourceId(), fence: f.fence, systemPrompt: 'inline only' });
    const material = await response.json() as BusinessMaterialDto;
    await tdb.db.execute(sql`UPDATE business_task.execution_materials SET object_count=NULL WHERE id=${material.materialId}`);
    await f.age(material.materialId); await f.sweep(); await f.sweep();
    expect(f.calls.releases).toEqual([]); expect(await f.state(material.materialId)).toMatchObject({ state: 'ready', object_count: 0 });
  });
});
