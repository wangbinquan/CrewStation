import { afterEach, describe, expect, test } from 'bun:test';
import type { BusinessSubtaskV3Dto, TaskId } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionAgentFixture } from './executionAgentFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-034 immutable business source binding', () => {
  let tdb: TestDatabase;
  afterEach(async () => { await tdb?.drop(); });
  test('source maps to the original task and attempt after the live runtime disappears', async () => {
    tdb = await createTestDatabase([businessTaskMigrations]); const f = await executionAgentFixture(tdb.db);
    const view = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    f.ready(); await f.module.api.v3.runOnce();
    const start = f.starts.find((entry) => entry.command.type === 'startBusinessAgent')!;
    if (start.command.type !== 'startBusinessAgent') throw new Error('missing start');
    const input = { runtimeTaskId: start.taskId, executionId: start.command.executionId, attempt: start.command.attempt,
      incarnation: start.command.incarnation, payloadDigest: start.command.payloadDigest };
    f.environments.delete(start.taskId);
    expect(await f.module.api.v3.resolveUsageSource(input)).toEqual({ projectId: f.projectId, taskId: f.task.id,
      subtaskId: view.id, executionId: view.executionId, executionGeneration: 1 });
    expect(await f.module.api.v3.resolveUsageSource({ ...input, runtimeTaskId: f.task.id })).toBeUndefined();
    expect(await f.module.api.v3.resolveUsageSource({ ...input, runtimeTaskId: Bun.randomUUIDv7() as TaskId })).toBeUndefined();
    expect(await f.module.api.v3.resolveUsageSource({ ...input, executionId: Bun.randomUUIDv7() })).toBeUndefined();
    for (const patch of [{ attempt: 2 }, { incarnation: crypto.randomUUID() }, { payloadDigest: 'b'.repeat(64) }])
      await expect(f.module.api.v3.resolveUsageSource({ ...input, ...patch })).rejects.toMatchObject({ kind: 'conflict' });
  });
});
