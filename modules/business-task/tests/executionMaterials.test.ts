import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { BusinessMaterialDto } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionCommandFixture } from './executionCommandFixture';
import { drizzleExecutionMaterials } from '../adapters/persistence/materials/repository';
import { executionCipher } from '../adapters/crypto/executionCipher';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 immutable business materials', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  test('concurrent request keys preserve one encrypted immutable record; replay never requires active execution authority', async () => {
    const f = await executionCommandFixture(tdb.db), path = `/v3/business-tasks/${f.task.id}/materials`;
    const input = { requestKey: 'material', fence: f.fence, systemPrompt: 'private review instructions', env: { APP_TOKEN: 'private-material-env' }, skills: [{ path: 'review/SKILL.md', content: 'private skill content' }] };
    const responses = await Promise.all(Array.from({ length: 6 }, () => f.request(path, input)));
    expect(responses.every((r) => r.status === 201)).toBe(true);
    const views = await Promise.all(responses.map((r) => r.json() as Promise<BusinessMaterialDto>));
    expect(new Set(views.map((v) => v.materialId)).size).toBe(1);
    const rows = await tdb.db.execute(sql`SELECT * FROM business_task.execution_materials WHERE task_id=${f.task.id}`);
    expect(rows).toHaveLength(1); expect(JSON.stringify(rows)).not.toContain('private');
    const stored = (await drizzleExecutionMaterials(tdb.db).get(f.serviceId, f.task.id, views[0]!.materialId))!;
    expect(JSON.parse(await executionCipher(Buffer.alloc(32, 27).toString('base64')).open(stored.sealed))).toMatchObject({ env: input.env, systemPrompt: input.systemPrompt, skills: input.skills });
    expect(await (await f.make().request(path, { ...input, fence: undefined })).json()).toEqual(views[0]);
    expect((await f.request(path, { ...input, systemPrompt: 'changed' })).status).toBe(409);
    expect((await f.request(path, { ...input, requestKey: 'new', fence: undefined })).status).toBe(409);
    const other = await executionCommandFixture(tdb.db); expect((await other.request(path, input)).status).toBe(404);
    expect(await drizzleExecutionMaterials(tdb.db).get(other.serviceId, other.task.id, views[0]!.materialId)).toBeUndefined();
  });
  test('oversize material and streaming body fail 413; reserved env, traversal, unknown fields and NUL fail before persistence', async () => {
    const f = await executionCommandFixture(tdb.db), path = `/v3/business-tasks/${f.task.id}/materials`, input = { requestKey: 'bad', fence: f.fence };
    expect((await f.request(path, { ...input, systemPrompt: 'x'.repeat(1024 * 1024) })).status).toBe(413);
    expect((await f.request(path, { ...input, systemPrompt: 'x'.repeat(3 * 1024 * 1024) })).status).toBe(413);
    expect((await f.request(path, { ...input, skills: Array.from({ length: 129 }, (_, i) => ({ path: `skill/${i}`, content: '' })) })).status).toBe(413);
    for (const invalid of [{ env: { CS_DATABASE_URL: 'bad' } }, { env: { APP_DATA: 'a\0b' } }, { skills: [{ path: '../steal', content: '' }] }, { provider: 'bypass' }]) expect((await f.request(path, { ...input, ...invalid })).status).toBe(400);
    const rows = await tdb.db.execute(sql`SELECT id FROM business_task.execution_materials WHERE task_id=${f.task.id}`); expect(rows).toHaveLength(0);
  });
});
