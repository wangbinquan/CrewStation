import { describe, expect, test } from 'bun:test';
import { DomainTopic } from '@crewstation/contracts';
import { createEventConsumer, readEventContents } from '@crewstation/eventbus';
import { noopLogger } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import type { Executor } from '@crewstation/persistence';
import { enqueueJob, queueMigrations, readQueueContents } from '@crewstation/queue';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { removeDeletionCoordinator } from '../adapters/persistence/deletionCoordinator';
import { deletionEnqueue, PROJECT_DELETION_JOB_KIND, projectDeletionRuntime } from '../workers/projectDeletionRuntime';
import { deletionFixture } from './deletionFixture';

const available = await testDatabaseAvailable();
async function fixture() {
  const f = await deletionFixture();
  try { await runMigrations(f.database.db, [queueMigrations]); }
  catch (error) { await f.database.drop(); throw error; }
  f.intents.complete = (lease) => f.api.completeProjectDeletion(lease, removeDeletionCoordinator);
  return { ...f, enqueue: deletionEnqueue(f.database.db, f.api.coordinateProjectDeletion) };
}
describe.skipIf(!available)('atomic deletion coordinator completion (actual PostgreSQL; other owners are orchestration fixtures)', () => {
  test('rollback retains the root, plan, queue and private event errors; retry clears every coordinator page and preserves other operations', async () => {
    const f = await fixture();
    try {
      const current = await f.start(), other = await f.start(); await f.enqueue(current.operation.id); await f.enqueue(other.operation.id);
      await f.database.db.execute(sql`INSERT INTO platform_infra.jobs(kind,payload,last_error)
        SELECT ${PROJECT_DELETION_JOB_KIND},jsonb_build_object('operationId',${current.operation.id}::text),'private coordinator error' FROM generate_series(1,205)`);
      await f.database.db.execute(sql`INSERT INTO platform_infra.domain_events(topic,payload,occurred_at)
        SELECT ${DomainTopic.projectDeletionRequested},jsonb_build_object('projectId',${current.value.id}::text,'operationId',${current.operation.id}::text,'occurredAt','2026-10-03T00:00:00Z'),now() FROM generate_series(1,205)`);
      const requested = (await readEventContents(f.database.db)).find((row) => row.topic === DomainTopic.projectDeletionRequested && (row.payload as { operationId: string }).operationId === current.operation.id)!;
      await f.database.db.execute(sql`INSERT INTO platform_infra.event_dead_letters(consumer,event_id,error) VALUES('coordinator-private',${requested.id}::bigint,'private event failure')`);
      const retainedQueue = (await readQueueContents(f.database.db)).find((row) => (row.payload as { operationId: string }).operationId === other.operation.id)!;
      const retainedEvent = (await readEventContents(f.database.db)).find((row) => row.topic === DomainTopic.projectDeletionRequested && (row.payload as { operationId: string }).operationId === other.operation.id)!;
      f.intents.complete = (lease) => f.api.completeProjectDeletion(lease, async (executor, operation) => { await removeDeletionCoordinator(executor, operation); throw new Error('controlled final transaction failure'); });
      await expect(f.controller.advance(current.operation.id)).rejects.toThrow();
      expect((await f.controller.read(f.admin, current.operation.id)).state).toBe('needs-attention');
      expect((await f.api.getProject(f.admin, current.value.id)).state).toBe('deleting');
      expect(await f.database.db.execute(sql`SELECT id FROM project.deletion_plans WHERE project_id=${current.value.id}`)).toHaveLength(1);
      expect(await f.database.db.execute(sql`SELECT id FROM platform_infra.jobs WHERE payload->>'operationId'=${current.operation.id}`)).toHaveLength(206);
      expect(await f.database.db.execute(sql`SELECT event_id FROM platform_infra.event_dead_letters WHERE event_id=${requested.id}::bigint`)).toHaveLength(1);
      await f.controller.retry(f.admin, current.operation.id);
      f.intents.complete = (lease) => f.api.completeProjectDeletion(lease, removeDeletionCoordinator);
      await f.controller.advance(current.operation.id);
      expect((await f.controller.read(f.admin, current.operation.id)).state).toBe('succeeded');
      expect(await f.database.db.execute(sql`SELECT id FROM project.projects WHERE id=${current.value.id}`)).toHaveLength(0);
      expect(await f.database.db.execute(sql`SELECT id FROM platform_infra.jobs WHERE payload->>'operationId'=${current.operation.id}`)).toHaveLength(0);
      expect(await f.database.db.execute(sql`SELECT id FROM platform_infra.domain_events WHERE payload->>'operationId'=${current.operation.id}`)).toHaveLength(0);
      expect(await f.database.db.execute(sql`SELECT event_id FROM platform_infra.event_dead_letters WHERE event_id=${requested.id}::bigint`)).toHaveLength(0);
      expect((await readQueueContents(f.database.db)).find((row) => row.id === retainedQueue.id)).toEqual(retainedQueue);
      expect((await readEventContents(f.database.db)).find((row) => row.id === retainedEvent.id)).toEqual(retainedEvent);
      await f.enqueue(current.operation.id);
      expect(await f.api.coordinateProjectDeletion(current.operation.id, async () => { throw new Error('terminal operation must not run'); })).toBe(false);
      expect(await f.api.coordinateProjectDeletion(Bun.randomUUIDv7(), async () => { throw new Error('missing operation must not run'); })).toBe(false);
    } finally { await f.database.drop(); }
  }, 30_000);
  test('the actual worker keeps its heartbeat through all receipts and removes its own row only at final commit', async () => {
    const f = await fixture();
    try {
      const current = await f.start(); await f.enqueue(current.operation.id);
      const runtime = projectDeletionRuntime(f.database.db, f.controller, 'atomic-coordinator', noopLogger);
      try { expect(await runtime.worker.runOnce()).toBe(1); }
      finally { await runtime.worker.stop(); }
      const result = await f.controller.read(f.admin, current.operation.id);
      expect(result.state).toBe('succeeded'); expect(result.receipts).toHaveLength(154);
      expect(await readQueueContents(f.database.db)).toEqual([]);
      expect((await readEventContents(f.database.db)).some((row) => row.topic === DomainTopic.projectDeletionRequested)).toBe(false);
    } finally { await f.database.drop(); }
  }, 30_000);
  test('an actual consumer holding its original event never waits for the final operation lock or recreates a terminal queue row', async () => {
    const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let advancing: Promise<void> | undefined;
    try {
      const current = await f.start(); await f.enqueue(current.operation.id);
      f.intents.complete = (lease) => f.api.completeProjectDeletion(lease, async (executor, operation) => { entered.resolve(); await release.promise; await removeDeletionCoordinator(executor, operation); });
      advancing = f.controller.advance(current.operation.id); await entered.promise;
      expect(await f.api.coordinateProjectDeletion(current.operation.id, async () => { throw new Error('busy operation must not enter'); })).toBe(false);
      let handled = 0;
      const consumer = createEventConsumer({ db: f.database.db, consumer: 'atomic-coordinator-consumer', logger: noopLogger })
        .on(DomainTopic.projectDeletionRequested, async (event) => { handled++; await f.enqueue(event.payload.operationId); });
      expect(await consumer.runOnce()).toBeGreaterThan(0); expect(handled).toBe(1);
      release.resolve(); await advancing;
      expect((await f.controller.read(f.admin, current.operation.id)).state).toBe('succeeded');
      await f.enqueue(current.operation.id); expect(await readQueueContents(f.database.db)).toEqual([]);
      expect(await f.database.db.execute(sql`SELECT last_event_id FROM platform_infra.event_cursors WHERE consumer='atomic-coordinator-consumer'`)).toHaveLength(1);
    } finally { release.resolve(); await advancing?.catch(() => undefined); await f.database.drop(); }
  }, 30_000);
  test('coordination writes roll back on failure; a mismatched project event prevents final deletion instead of clearing foreign content', async () => {
    const f = await fixture();
    try {
      const current = await f.start();
      await expect(f.api.coordinateProjectDeletion(current.operation.id, async (executor) => {
        await enqueueJob(executor as Executor, PROJECT_DELETION_JOB_KIND, { operationId: current.operation.id }); throw new Error('controlled enqueue rollback');
      })).rejects.toThrow();
      expect(await readQueueContents(f.database.db)).toEqual([]);
      await f.database.db.execute(sql`UPDATE platform_infra.domain_events SET payload=jsonb_set(payload,'{projectId}',to_jsonb(${Bun.randomUUIDv7()}::text)) WHERE topic=${DomainTopic.projectDeletionRequested}`);
      await expect(f.controller.advance(current.operation.id)).rejects.toThrow();
      expect((await f.controller.read(f.admin, current.operation.id)).state).toBe('needs-attention');
      expect((await f.api.getProject(f.admin, current.value.id)).state).toBe('deleting');
      expect(await f.api.coordinateProjectDeletion(current.operation.id, async () => { throw new Error('blocked operation must not enter'); })).toBe(false);
      expect((await readEventContents(f.database.db)).some((row) => row.topic === DomainTopic.projectDeletionRequested)).toBe(true);
    } finally { await f.database.drop(); }
  }, 30_000);
});
