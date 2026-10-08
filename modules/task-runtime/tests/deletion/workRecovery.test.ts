import { describe, expect, test } from 'bun:test';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { withSharedDatabaseAdmission } from '@crewstation/persistence';
import type { Database } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { runtimeProjectAdmissionKey } from '../../adapters/persistence/deletion/projectWork';
import { observeRuntimeWork } from '../../adapters/persistence/deletion/workRecovery';
import { runtimeWorkIdentity } from '../../domain/deletion/work';
import { runtimeWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('runtime original whole-Pod recovery (actual PG)', () => {
  test('reads only matching outstanding births to EOF while preserving ended history and other Pod identities', async () => {
    const f = await runtimeWorkFixture();
    try {
      await f.work.run(f.input(), async () => undefined);
      const [completed] = await f.work.history(f.project);
      const originals = Array.from({ length: 205 }, () => ({ id: newResourceId(), reference: newResourceId(), consumer: newResourceId(), process: f.original }));
      const unrelated = [
        { ...f.original, podUid: newResourceId() },
        { ...f.original, nodeUid: newResourceId() },
        { ...f.original, nodeName: 'another-controlled-node' },
      ].map((process) => ({ id: newResourceId(), reference: newResourceId(), consumer: newResourceId(), process }));
      await withSharedDatabaseAdmission(f.database.db, runtimeProjectAdmissionKey(f.project), async (guard) => {
        const pid = (await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid;
        await f.database.db.transaction((tx) => tx.execute(sql`INSERT INTO task_runtime.original_callbacks(id,project_id,origin_kind,origin_key,origin_id,kind,reference,consumer_id,input_digest,origin_revision,backend_pid,original_process,exit_key_hash)
          SELECT r.id,${f.project},'task',${f.parent},${f.parent},'native-job',r.reference,r.consumer,${jsonHash('original-input')},${completed!.originRevision},${pid},r.process,${jsonHash('private-original-exit')}
          FROM jsonb_to_recordset(${JSON.stringify([...originals, ...unrelated])}::jsonb) r(id text,reference text,consumer text,process jsonb)`));
      });
      const before = await f.work.history(f.project);
      const delivered: string[] = [];
      // Real rollout recovery stalled on millions of ended rows for a handful of pending births.
      // Observe actual DB replies, so a JS-only filter still fails this regression.
      const traced = new Proxy(f.database.db, { get(db, property, receiver) {
        if (property !== 'transaction') return Reflect.get(db, property, receiver);
        return (action: Parameters<Database['transaction']>[0]) => db.transaction((tx) => action(new Proxy(tx, { get(executor, key, target) {
          if (key !== 'execute') return Reflect.get(executor, key, target);
          return async (query: SQL) => {
            const rows = await executor.execute(query);
            for (const row of rows) if ('original_process' in row) delivered.push(String(row['id']));
            return rows;
          };
        } })));
      } });
      f.stopped(true);
      await observeRuntimeWork(traced, f.sources.processes);
      expect(delivered.toSorted()).toEqual(originals.map((row) => row.id).toSorted());
      const after = await f.work.history(f.project);
      expect(after).toHaveLength(before.length);
      expect(after.find((row) => row.id === completed!.id)).toEqual(completed);
      for (const original of unrelated) expect(after.find((row) => row.id === original.id)).toEqual(before.find((row) => row.id === original.id));
      for (const original of originals) {
        const recovered = after.find((row) => row.id === original.id)!;
        expect(recovered.exited).toBe(true);
        expect(recovered.recoveryDigest).toBe(jsonHash({ controlledWholePodStop: { podUid: f.original.podUid, nodeUid: f.original.nodeUid, nodeName: f.original.nodeName } }));
        expect(recovered.exitDigest).toBe(runtimeWorkIdentity(recovered, recovered.recoveryDigest!));
      }
    } finally { await f.work.drain(); await f.drop(); }
  });
});
