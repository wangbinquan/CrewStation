import { describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PHASES, ExecutionObservationIdentitySchema } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { observationDeletionFixture, originalCapture } from './observationDeletionFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('original observation drain composition (real factories/PG/HTTP; controlled upstream Root)', () => {
  // The budget includes migrations, 114 persisted observations, ACK replay and all seven phases.
  // Session requests keep their own one-second deadline; full-suite database load needs more headroom.
  test('loss before and after ACK resumes without duplicate usage, drains over the ordinary cap, freezes final content and preserves another project', async () => {
    const f = await observationDeletionFixture();
    try {
      expect((await f.seal()).kind).toBe('done');
      const measurement = originalCapture(1).measurements[0]!, { actualModel: _model, ...evidence } = measurement;
      const ownPage = { projectId: f.projectId, taskId: f.businessIdentity.taskId, sourceId: 'ordinary-late', expectedCursor: null, nextCursor: 'late:1', events: [{ eventId: 'late:1',
        measurement: { ...evidence, kind: 'usage' as const, identity: f.businessIdentity, sourceId: 'ordinary-late', modelRef: null } }] };
      await expect(f.module.api.ingestExecutionUsage(ownPage)).rejects.toThrow();
      f.fault('before'); await expect(f.owner.run(f.context('stop'))).rejects.toThrow('ACK request lost');
      expect((await f.database.db.execute<{ cursor: string }>(sql`SELECT cursor FROM observability.usage_sources`))[0]?.cursor).toBe('runner:5');
      expect((await f.database.db.execute<{ acknowledged_through: number }>(sql`SELECT acknowledged_through::int AS acknowledged_through FROM session.business_usage_sources`))[0]?.acknowledged_through).toBe(0);
      expect((await f.database.db.execute<{ phase_index: number }>(sql`SELECT phase_index FROM observability.deletion_fences`))[0]?.phase_index).toBe(0);
      f.fault('after'); await expect(f.owner.run(f.context('stop'))).rejects.toThrow('ACK response lost');
      expect((await f.database.db.execute<{ acknowledged_through: number }>(sql`SELECT acknowledged_through::int AS acknowledged_through FROM session.business_usage_sources`))[0]?.acknowledged_through).toBe(5);
      f.revoke(); await expect(f.owner.run(f.context('stop'))).rejects.toThrow('Root expired'); f.restore();
      const stopped = await f.owner.run(f.context('stop')); expect(stopped.kind).toBe('done');
      const requests = f.requests(); expect(await f.owner.run(f.context('stop'))).toEqual(stopped); expect(f.requests()).toBe(requests);
      const [counts] = await f.database.db.execute<{ usage: number; values: number; admissions: number }>(sql`SELECT
        (SELECT count(*)::int FROM observability.usage_projections) AS usage,(SELECT count(*)::int FROM observability.execution_valuations) AS values,
        (SELECT count(*)::int FROM observability.deletion_drain_admissions) AS admissions`);
      expect(counts).toEqual({ usage: 114, values: 114, admissions: 0 });
      expect((await f.database.db.execute<{ acknowledged_through: number }>(sql`SELECT acknowledged_through::int AS acknowledged_through FROM session.business_usage_sources`))[0]?.acknowledged_through).toBe(106);
      expect((await f.database.db.execute<{ source_acknowledged_through: number }>(sql`SELECT source_acknowledged_through::int AS source_acknowledged_through FROM session.development_usage_streams`))[0]?.source_acknowledged_through).toBe(8);
      const [value] = await f.database.db.execute<{ input: string }>(sql`SELECT document->'usage'->>'input' AS input FROM observability.usage_projections LIMIT 1`);
      expect(value?.input).toBe('9007199254740993');
      const [fence] = await f.database.db.execute<{ revision: string; stopped_revision: string; stopped_count: number }>(sql`SELECT revision,stopped_revision,stopped_count FROM observability.deletion_fences`);
      expect(fence?.stopped_revision).not.toBe(fence?.revision); expect(fence?.stopped_count).toBeGreaterThan(114);
      const healthyIdentity = ExecutionObservationIdentitySchema.parse({ ...f.businessIdentity, projectId: f.otherId, taskId: newResourceId(), executionId: newResourceId() });
      const healthy = { ...ownPage, projectId: f.otherId, taskId: healthyIdentity.taskId, events: [{ ...ownPage.events[0]!, measurement: { ...ownPage.events[0]!.measurement, identity: healthyIdentity } }] };
      await f.module.api.ingestExecutionUsage(healthy);
      const healthyKey = jsonHash({ projectId: f.otherId, taskId: healthyIdentity.taskId });
      const before = await f.database.db.execute(sql`SELECT document FROM observability.usage_projections WHERE task_key=${healthyKey}`);
      for (const phase of PROJECT_DELETION_PHASES.slice(2)) expect((await f.owner.run(f.context(phase))).kind).toBe('done');
      expect(await f.database.db.execute(sql`SELECT document FROM observability.usage_projections WHERE task_key=${healthyKey}`)).toEqual(before);
      expect(await f.database.db.execute(sql`SELECT task_key FROM observability.usage_heads WHERE project_id=${f.projectId}`)).toHaveLength(0);
      expect(await f.database.db.execute(sql`SELECT 1 FROM observability.usage_projections WHERE task_key<>${healthyKey}`)).toHaveLength(0);
      await expect(f.module.api.ingestExecutionUsage(ownPage)).rejects.toThrow();
    } finally { f.restore(); await f.close(); }
  }, 90_000);
});
