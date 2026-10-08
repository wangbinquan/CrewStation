import { describe, expect, test } from 'bun:test';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { withSharedDatabaseAdmission } from '@crewstation/persistence';
import type { Database } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { runtimeContentSnapshot } from '../../adapters/persistence/deletion/inspection';
import { runtimeProjectAdmissionKey } from '../../adapters/persistence/deletion/projectWork';
import { runtimeWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('runtime content original sources (actual PG)', () => {
  test('reuses immutable sources within each complete snapshot and still rejects a late mismatched callback', async () => {
    const f = await runtimeWorkFixture();
    try {
      await f.work.run(f.input(), async () => undefined);
      await f.work.run(f.input(f.otherProject, f.otherParent), async () => undefined);
      const [completed] = await f.work.history(f.project);
      const pending = Array.from({ length: 505 }, () => ({ id: newResourceId(), reference: newResourceId(), consumer: newResourceId(), process: f.original }));
      await withSharedDatabaseAdmission(f.database.db, runtimeProjectAdmissionKey(f.project), async (guard) => {
        const pid = (await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid;
        await f.database.db.transaction((tx) => tx.execute(sql`INSERT INTO task_runtime.original_callbacks(id,project_id,origin_kind,origin_key,origin_id,kind,reference,consumer_id,input_digest,origin_revision,backend_pid,original_process,exit_key_hash)
          SELECT r.id,${f.project},'task',${f.parent},${f.parent},'native-job',r.reference,r.consumer,${jsonHash('original-input')},${completed!.originRevision},${pid},r.process,${jsonHash('private-original-exit')}
          FROM jsonb_to_recordset(${JSON.stringify(pending)}::jsonb) r(id text,reference text,consumer text,process jsonb)`));
      });
      const originalRows = () => f.database.db.execute(sql`SELECT to_jsonb(r) AS body FROM task_runtime.original_callbacks r ORDER BY id COLLATE "C"`);
      const before = await originalRows();
      const originReads: string[] = [];
      // Observe real SQL responses; every original callback still goes through ownership validation.
      const traced = new Proxy(f.database.db, { get(db, property, receiver) {
        if (property !== 'transaction') return Reflect.get(db, property, receiver);
        return (action: Parameters<Database['transaction']>[0], config: Parameters<Database['transaction']>[1]) => db.transaction((tx) => action(new Proxy(tx, { get(executor, key, target) {
          if (key !== 'execute') return Reflect.get(executor, key, target);
          return async (query: SQL) => {
            const rows = await executor.execute(query);
            for (const row of rows) if ('identity' in row && 'revision' in row && 'project_id' in row && 'id' in row) originReads.push(String(row['id']));
            return rows;
          };
        } })), config);
      } });
      const inspect = () => runtimeContentSnapshot(traced, f.sources, f.project);
      const first = await inspect();
      expect(first.traversal.complete).toBe(true);
      expect(first.traversal.counts['original_callbacks']).toBe(507);
      expect(first.contents.filter((row) => row.table === 'original_callbacks')).toHaveLength(506);
      expect(first.origins.filter((row) => row.kind === 'task' && row.key === f.otherParent)).toHaveLength(0);
      expect(await originalRows()).toEqual(before);
      expect(originReads.toSorted()).toEqual([f.parent, f.otherParent].toSorted());
      originReads.length = 0;
      expect(await inspect()).toEqual(first);
      expect(originReads.toSorted()).toEqual([f.parent, f.otherParent].toSorted());
      // Corrupt only the isolated fixture after two full reads. The last row must still be checked after the source is cached.
      await f.database.db.execute(sql.raw('ALTER TABLE task_runtime.original_callbacks DISABLE TRIGGER USER'));
      try { await f.database.db.execute(sql`UPDATE task_runtime.original_callbacks SET origin_revision=${'b'.repeat(64)} WHERE id=${pending.at(-1)!.id}`); }
      finally { await f.database.db.execute(sql.raw('ALTER TABLE task_runtime.original_callbacks ENABLE TRIGGER USER')); }
      await expect(inspect()).rejects.toThrow('原父记录关系不符');
    } finally { await f.work.drain(); await f.drop(); }
  }, 30_000);
});
