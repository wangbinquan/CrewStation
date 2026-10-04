import { describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PHASES, TaskIdSchema, ExecutionObservationIdentitySchema } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { observationDeletionUsageDatabase } from '../adapters/persistence/deletionUsageDatabase';
import { drizzleUsageLedger } from '../adapters/persistence/drizzleUsageLedger';
import { usageIngestion } from '../application/usageIngestion';
import { fixture, target } from './projectDeletionFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('private original usage transaction admission (real PostgreSQL)', () => {
  test('requires retained tasks and actual private admission; confines SQL to numerical copies and rolls back when Root expires', async () => {
    const ids = [TaskIdSchema.parse(newResourceId()), TaskIdSchema.parse(newResourceId())], f = await fixture(false, { list: async () => ({ ids, complete: true }) });
    try {
      const confirmed = await f.owner.inspect(target); expect((await f.owner.run(f.context(confirmed, 'seal'))).kind).toBe('done');
      let valid = true;
      const input = { ...f.input, assertGrant: async (context: Parameters<typeof f.input.assertGrant>[0]) => { await f.input.assertGrant(context); if (!valid) throw precondition('controlled Root revoked'); } };
      const context = f.context(confirmed, 'stop'), scope = { projectId: target.id, taskId: ids[0]! };
      const db = observationDeletionUsageDatabase(input, context, scope);
      const page = (taskId = scope.taskId) => {
        const identity = ExecutionObservationIdentitySchema.parse({ projectId: target.id, taskId, subtaskId: newResourceId(), executionId: newResourceId(), executionGeneration: 1 });
        return { ...scope, taskId, sourceId: 'original-source', expectedCursor: null, nextCursor: 'original:1', events: [{ eventId: 'original:1', measurement: { kind: 'usage' as const, identity,
          sourceId: 'original-source', recordId: 'original-meter', revision: 1, occurredAt: null, observedAt: '2026-10-04T00:00:00Z', adapterVersion: 'original@1', modelRef: null,
          reporting: 'delta' as const, inclusion: 'self' as const, coverage: 'partial' as const, validity: 'valid' as const, scope: null, coveredThroughTurn: null, basis: { kind: 'invocation' as const },
          usage: { input: '9007199254740993', output: '11', cacheRead: null, cacheWrite: '0' } } }] };
      };
      await expect(usageIngestion(drizzleUsageLedger(db))(page(ids[1]!))).rejects.toMatchObject({ cause: { code: '55000' } });
      const unsealed = observationDeletionUsageDatabase(input, context, { ...scope, taskId: TaskIdSchema.parse(newResourceId()) });
      await expect(unsealed.transaction(async () => {})).rejects.toMatchObject({ cause: { code: '55000' } });
      await expect(db.transaction((tx) => tx.execute(sql`INSERT INTO observability.alerts(id,project_id,type,key,state,detail,fired_at)
        VALUES(${newResourceId()},${target.id},'health-failing','health-failing:prod','firing','not numerical',now())`))).rejects.toMatchObject({ cause: { code: '55000' } });
      await expect(db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO observability.usage_heads(task_key,project_id,task_id,sequence) VALUES(${jsonHash(scope)},${scope.projectId},${scope.taskId},0)`);
        valid = false;
      })).rejects.toThrow('Root revoked'); valid = true;
      expect(await f.database.db.execute(sql`SELECT task_key FROM observability.usage_heads`)).toHaveLength(0);
      const original = page(); await usageIngestion(drizzleUsageLedger(db))(original);
      const foreign = page(ids[1]!);
      await usageIngestion(drizzleUsageLedger(observationDeletionUsageDatabase(input, context, { ...scope, taskId: ids[1]! })))(foreign);
      await expect(db.transaction((tx) => tx.execute(sql`UPDATE observability.usage_evidence SET document=jsonb_set(document,'{identity,taskId}',to_jsonb(${scope.taskId}::text))
        WHERE document->'identity'->>'taskId'=${ids[1]}`))).rejects.toMatchObject({ cause: { code: '55000' } });
      expect(await f.database.db.execute(sql`SELECT * FROM observability.deletion_drain_admissions`)).toHaveLength(0);
      await expect(f.database.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('crewstation.observability_drain',${crypto.randomUUID()},true),set_config('crewstation.observability_deletion',${f.operationId + ':1:stop'},true)`);
        await tx.execute(sql`INSERT INTO observability.usage_sources(task_key,source_id,cursor) VALUES(${jsonHash(scope)},'forged','forged:1')`);
      })).rejects.toMatchObject({ cause: { code: '55000' } });
      expect((await f.owner.run(context)).kind).toBe('done');
      await expect(usageIngestion(drizzleUsageLedger(db))(original)).rejects.toThrow('停止已经完成');
      await expect(withExclusiveDatabaseAdmission(f.database.db, 'observability.project:' + target.id, async (tx) => {
        await tx.execute(sql`SELECT set_config('crewstation.observability_deletion',${f.operationId + ':1:purge'},true)`);
        await tx.execute(sql`UPDATE observability.deletion_fences SET phase_index=2,stopped_count=stopped_count+1 WHERE project_id=${target.id}`);
      })).rejects.toMatchObject({ cause: { code: '55000' } });
      for (const phase of PROJECT_DELETION_PHASES.slice(2)) expect((await f.owner.run(f.context(confirmed, phase))).kind).toBe('done');
      expect(await f.database.db.execute(sql`SELECT task_key FROM observability.usage_heads`)).toHaveLength(0);
    } finally { await f.database.drop(); }
  });
});
