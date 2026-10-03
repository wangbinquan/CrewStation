import { describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId, SubtaskId, TaskId, TraceId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { newResourceId } from '@crewstation/kernel';
import { resourceIdentityDirectory } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { drizzleTaskRepository, drizzleSubtaskRepository } from '../../adapters/persistence/drizzleRepositories';
import { businessTaskMigrations, createBusinessTaskModule } from '../../wiring';
import type { BusinessTaskModuleDeps } from '../../wiring';
import { executionCommandFixture } from '../executionCommandFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('business infrastructure ownership (actual PG, minimum identity only)', () => {
  test('legacy task/subtask public reads preserve project relations and reject orphan or aliased conflicts', async () => {
    const f = await createTestDatabase([eventbusMigrations, businessTaskMigrations]);
    try {
      const unused = new Proxy({}, { get: (_target, name) => () => { throw new Error('Ownership read called ' + String(name)); } });
      const mod = createBusinessTaskModule({ db: f.db, environments: unused, runner: unused, directory: unused, authorizer: unused, compute: unused,
        isAdmin: async () => false, settings: { mcp: [], outputLimitBytes: 1024, consumerName: 'infrastructure' } } as unknown as BusinessTaskModuleDeps);
      const taskId = newResourceId() as TaskId, subtaskId = newResourceId() as SubtaskId, projectId = newResourceId() as ProjectId;
      const serviceId = newResourceId() as ServiceId, now = new Date();
      await drizzleTaskRepository(f.db).insert({ id: taskId, serviceId, projectId, callerIdentity: 'private/caller', state: 'closed', traceId: '1'.repeat(32) as TraceId,
        volumeMode: 'follow-container', profile: 'private-profile', labels: { secret: 'private-label' }, createdAt: now, updatedAt: now });
      await drizzleSubtaskRepository(f.db).insert({ id: subtaskId, taskId, name: 'private-subtask', kind: 'agent', mode: 'oneshot', state: 'succeeded', attempt: 1, createdAt: now, output: 'private-output' });
      const read = mod.api.originalInfrastructureOwnership, task = await read('task', taskId), child = await read('subtask', subtaskId);
      expect(task).toMatchObject({ id: taskId, scope: 'project', projectIds: [projectId] });
      expect(child).toMatchObject({ id: subtaskId, scope: 'project', projectIds: [projectId] });
      const directory = resourceIdentityDirectory(f.db, () => [businessTaskMigrations]);
      await directory.bind('business_task', 'subtask', ['private-old-child'], subtaskId);
      expect(await read('subtask', 'private-old-child', 'legacy')).toEqual(child);
      expect(await read('task', taskId, 'legacy')).toEqual(task);
      expect(await read('task', newResourceId())).toBeUndefined();
      expect(await read('subtask', 'unknown-child', 'legacy')).toBeUndefined();
      await expect(read('task', taskId, 'invalid' as never)).rejects.toThrow('未登记');
      for (const value of ['private/caller', 'private-profile', 'private-label', 'private-subtask', 'private-output', 'private-old-child']) expect(JSON.stringify([task, child])).not.toContain(value);
      await f.db.execute(sql`DELETE FROM business_task.tasks WHERE id=${taskId}`);
      expect(await read('subtask', subtaskId)).toBeUndefined();
      await directory.bind('business_task', 'subtask', [subtaskId], newResourceId());
      await expect(read('subtask', subtaskId)).rejects.toThrow('目录冲突');
    } finally { await f.drop(); }
  });
  test('actual v3 admissions and command children resolve the same project; conflicting original intent blocks', async () => {
    const database = await createTestDatabase([eventbusMigrations, businessTaskMigrations]);
    try {
      const f = await executionCommandFixture(database.db);
      const response = await f.request(f.path, f.input);
      expect(response.status).toBe(201);
      const child = await response.json() as { id: string };
      const read = f.module.api.originalInfrastructureOwnership;
      const parent = await read('task', f.task.id), original = await read('subtask', child.id);
      expect(parent).toMatchObject({ id: f.task.id, projectIds: [f.projectId] });
      expect(original).toMatchObject({ id: child.id, projectIds: [f.projectId] });
      expect(JSON.stringify(original)).not.toContain('APP_TOKEN');
      await database.db.execute(sql`UPDATE business_task.execution_operations SET intent=jsonb_set(intent,'{task,serviceId}',to_jsonb(${newResourceId()}::text)) WHERE intent->'task'->>'id'=${f.task.id}`);
      await expect(read('task', f.task.id)).rejects.toThrow('受理关系冲突');
    } finally { await database.drop(); }
  });
});
