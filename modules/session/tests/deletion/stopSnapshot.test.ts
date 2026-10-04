import { describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { SessionStopSnapshotSchema } from '../../domain/deletion/stopSnapshot';
import { sessionDeletionFixture } from './fixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('Session stop snapshot/CAS (real PG; controlled ownership)', () => {
  test('changed private columns after stop block every deletion; repaired original bytes permit one atomic metadata commit and preserve the other project', async () => {
    const f = await sessionDeletionFixture();
    try {
      const own = f.task(), other = f.task(f.otherProject); await f.seed(own); await f.seed(other);
      const context = await f.context(), owner = f.first.module.api.deletionOwner!;
      for (const phase of PROJECT_DELETION_PHASES.slice(0, 5)) expect((await owner.run({ ...context, phase })).kind).toBe('done');
      const frozen = (await f.database.db.execute<{ body: { stopped: unknown } }>('SELECT body FROM session.project_deletions'))[0]!.body.stopped;
      expect(SessionStopSnapshotSchema.parse(frozen).tables).toHaveLength(12);
      const retained = await f.database.db.execute(sql`SELECT session.digest(to_jsonb(e)) AS hash FROM session.runner_events e WHERE task_id=${other}`);
      const before = (await f.database.db.execute<{ legacy_event: unknown }>(sql`SELECT legacy_event FROM session.runner_events WHERE task_id=${own}`))[0]!.legacy_event;
      // Simulate real row drift, including a column that the user-facing event DTO does not expose.
      await f.database.db.execute('ALTER TABLE session.runner_events DISABLE TRIGGER session_content_guard');
      await f.database.db.execute(sql`UPDATE session.runner_events SET legacy_event='{"private":"changed after stop"}' WHERE task_id=${own}`);
      await f.database.db.execute('ALTER TABLE session.runner_events ENABLE TRIGGER session_content_guard');
      await expect(owner.run({ ...context, phase: 'metadata' })).rejects.toThrow('行摘要发生变化');
      expect(await f.database.db.execute(sql`SELECT seq FROM session.runner_events WHERE task_id=${own}`)).toHaveLength(1);
      expect((await f.database.db.execute<{ phases: Record<string, unknown> }>('SELECT phases FROM session.project_deletions'))[0]!.phases.metadata).toBeUndefined();
      await f.database.db.execute('ALTER TABLE session.runner_events DISABLE TRIGGER session_content_guard');
      await f.database.db.execute(sql`UPDATE session.runner_events SET legacy_event=${JSON.stringify(before)}::jsonb WHERE task_id=${own}`);
      await f.database.db.execute('ALTER TABLE session.runner_events ENABLE TRIGGER session_content_guard');
      expect((await owner.run({ ...context, phase: 'metadata' })).kind).toBe('done');
      const result = (await f.database.db.execute<{ body: { stopped: unknown; compacted: boolean }; phases: Record<string, unknown> }>('SELECT body,phases FROM session.project_deletions'))[0]!;
      expect(result.body.compacted).toBe(true); expect(result.phases.metadata).toBeDefined(); expect(jsonHash(result.body.stopped)).toBe(jsonHash(frozen));
      expect(await f.database.db.execute(sql`SELECT session.digest(to_jsonb(e)) AS hash FROM session.runner_events e WHERE task_id=${other}`)).toEqual(retained);
      expect((await owner.run({ ...context, phase: 'verify' })).kind).toBe('done');
    } finally { await f.drop(); }
  });

  test('the complete selector spans more than PostgreSQL single-statement parameter capacity and still includes its last real task', async () => {
    const f = await sessionDeletionFixture();
    try {
      const task = f.task(); await f.seed(task);
      const keys = [...Array.from({ length: 70_000 }, (_, index) => 'original-legacy-key-' + index), task];
      const [row] = await f.database.db.execute<{ body: unknown }>(sql`SELECT session.stop_snapshot(${f.projectId},${JSON.stringify(keys)}::jsonb) AS body`);
      const snapshot = SessionStopSnapshotSchema.parse(row!.body);
      expect(snapshot.tables).toHaveLength(12); expect(snapshot.tables.find((table) => table.table === 'runner_events')?.count).toBe(1);
      expect(snapshot.count).toBe(9); expect(snapshot.tables.at(-1)?.count).toBe(0);
      expect(await f.database.db.execute('SELECT task_id FROM session.runner_events')).toHaveLength(1);
    } finally { await f.drop(); }
  }, 15_000);
});
