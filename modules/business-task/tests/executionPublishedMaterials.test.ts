import { afterEach, describe, expect, test } from 'bun:test';
import type { BusinessMaterialDto, BusinessSubtaskV3Dto } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionAgentFixture } from './executionAgentFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 published Agent material snapshots', () => {
  let db: TestDatabase; afterEach(async () => { await db?.drop(); });
  test('static prompt plus allowed dynamic append and output schema travel to Agent without repository checkout', async () => {
    db = await createTestDatabase([businessTaskMigrations]);
    const f = await executionAgentFixture(db.db, { prompt: 'published instructions', schema: '{"type":"object"}' });
    const material = await (await f.request(`/v3/business-tasks/${f.task.id}/materials`, { requestKey: 'material', systemPrompt: 'node instructions', fence: f.fence })).json() as BusinessMaterialDto;
    const response = await f.request(f.path, { ...f.input, materialId: material.materialId, outputContractId: f.contractId });
    expect(response.status).toBe(202); const run = await response.json() as BusinessSubtaskV3Dto;
    f.ready(); await f.module.api.v3.runOnce();
    const start = f.starts.find((entry) => entry.command.type === 'startBusinessAgent')!.command;
    if (start.type !== 'startBusinessAgent') throw new Error('start');
    expect(start.agent.systemPrompt).toBe('published instructions\n\nnode instructions');
    expect(start.agent.businessOutputContract).toEqual({ id: f.contractId, required: ['result.json'], schemaDocument: '{"type":"object"}' });
    expect((await f.get(run.id)).profileRevision).toBe(1);
  });
  test('missing fixed source material is explicit rejection before any Agent Pod', async () => {
    db = await createTestDatabase([businessTaskMigrations]); const f = await executionAgentFixture(db.db, { missing: true });
    const response = await f.request(f.path, f.input);
    expect(response.status).toBe(412); expect(await response.json()).toMatchObject({ details: { code: 'release_material_missing' } });
    expect(f.creates).toHaveLength(0);
  });
});
