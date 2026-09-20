import { describe, expect, test } from 'bun:test';
import type { SubtaskId, TaskId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { resourceIdentityDirectory } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleSubtaskRepository } from '../adapters/persistence/drizzleRepositories';
import { legacyBusinessIdentity } from '../adapters/persistence/legacyBusinessIdentity';
import { businessTaskMigrations } from '../wiring';
import type { SubtaskRun } from '../domain/subtaskRun';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('business resource identities', () => {
  test('concurrent retry reservations share one UUID without deriving it from the operation, and v1 names resolve within their service', async () => {
    const tdb = await createTestDatabase([businessTaskMigrations]);
    try {
      const repository = drizzleSubtaskRepository(tdb.db);
      const taskId = newResourceId() as TaskId, previousId = newResourceId() as SubtaskId, operationId = newResourceId();
      const run = (): SubtaskRun => ({ id: newResourceId() as SubtaskId, taskId, name: 'Retry', kind: 'command', state: 'pending', attempt: 2, command: ['true'], runnerRef: newResourceId(), retry: { operationId, previousId }, createdAt: new Date() });
      const accepted = await Promise.all([repository.reserveRetry(run()), repository.reserveRetry(run())]);
      expect(accepted.filter((result) => result.created)).toHaveLength(1);
      expect(accepted[0]!.run.id).toBe(accepted[1]!.run.id);
      expect(accepted[0]!.run.id).not.toBe(operationId);
      expect((await repository.findRetry(taskId, operationId))?.id).toBe(accepted[0]!.run.id);
      await expect(repository.reserveRetry({ ...run(), retry: { operationId, previousId: newResourceId() as SubtaskId } })).rejects.toMatchObject({ kind: 'conflict' });
      const directory = resourceIdentityDirectory(tdb.db, () => [businessTaskMigrations]);
      const a = newResourceId(), b = newResourceId(), first = newResourceId(), second = newResourceId();
      await directory.bind('business_task', 'agent-profile', [a, 'same-name'], first);
      await directory.bind('business_task', 'agent-profile', [b, 'same-name'], second);
      const legacy = legacyBusinessIdentity(directory), input = { kind: 'agent' as const, name: 'job', agentProfile: 'same-name', mode: 'oneshot' as const, prompt: 'hello' };
      expect(await legacy.inputSubtask(input, a)).toMatchObject({ agentProfileId: first });
      expect(await legacy.inputSubtask(input, b)).toMatchObject({ agentProfileId: second });
      await expect(legacy.inputSubtask(input, newResourceId())).rejects.toMatchObject({ kind: 'validation' });
      const wire = await legacy.subtask({ id: accepted[0]!.run.id, taskId, name: 'job', kind: 'command', state: 'pending', attempt: 2 }, a);
      expect(await legacy.subtaskId(wire.id)).toBe(accepted[0]!.run.id);
      expect(await legacy.taskId(wire.taskId)).toBe(taskId);
    } finally { await tdb.drop(); }
  });
});
