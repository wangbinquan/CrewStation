import { describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { sessionConnectionHistory } from '../../adapters/persistence/deletion/lifetime';
import { sessionDeletionFixture } from './fixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('original session Pod recovery (actual PG; controlled whole-Pod physical source)', () => {
  test('a newly admitted birth cannot insert an already exited receipt while its original scope is still active', async () => {
    const f = await sessionDeletionFixture();
    try {
      const taskId = f.task(), history = sessionConnectionHistory(f.database.db, f.source), original = { id: newResourceId(), taskId,
        replica: f.first.address, at: new Date().toISOString(), exitKeyHash: jsonHash('original private key') }, identity = jsonHash(original);
      await expect(history.open(taskId, () => f.database.db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO session.connections(task_id,replica,consumer_id,connected_at,last_seen_at) VALUES(${taskId},${original.replica},${original.id},${original.at}::timestamptz,now())`);
        await tx.execute(sql`INSERT INTO session.connection_births(id,task_key,replica,connected_at,exit_key_hash,identity,backend_pid,exited_at,exit_digest)
          VALUES(${original.id},${taskId},${original.replica},${original.at}::timestamptz,${original.exitKeyHash},${identity},current_setting('crewstation.shared_admission_pid')::integer,now(),${identity})`);
      }))).rejects.toMatchObject({ cause: { message: expect.stringContaining('original admitted connection') } });
      expect(await f.database.db.execute('SELECT id FROM session.connection_births')).toHaveLength(0);
    } finally { await f.drop(); }
  });
  test('old container status and a different node cannot end transport; original complete Pod stop recovers only the bound birth and compacts its content', async () => {
    const process = { podUid: Bun.randomUUIDv7(), containerId: 'containerd://' + 'a'.repeat(64), nodeUid: Bun.randomUUIDv7(), nodeName: 'original-node',
      pid: 1, pidNamespace: '345', bootId: Bun.randomUUIDv7(), startTicks: '90' };
    let mode: 'container' | 'wrong-node' | 'original-pod' = 'container';
    const f = await sessionDeletionFixture({ protectCurrent: async () => process, sweep: async (accept) => {
      if (mode === 'container') await accept.stopped(process, jsonHash('old container termination'));
      else await accept.podStopped({ podUid: process.podUid, nodeUid: mode === 'wrong-node' ? Bun.randomUUIDv7() : process.nodeUid, nodeName: process.nodeName }, jsonHash('complete original Pod stop'));
    } });
    try {
      const task = f.task(), history = sessionConnectionHistory(f.database.db, f.source), key = 'original private key';
      const birth = await history.open(task, () => history.birth({ id: newResourceId(), taskId: task, replica: 'http://127.0.0.1:1', at: new Date().toISOString(), exitKeyHash: jsonHash(key) }));
      const context = await f.context(), owner = f.first.module.api.deletionOwner!;
      expect(birth.process).toEqual(process); expect((await owner.run(context)).kind).toBe('done');
      expect(await owner.run({ ...context, phase: 'stop' })).toMatchObject({ kind: 'waiting' });
      expect(await f.database.db.execute('SELECT identity FROM session.process_stops')).toHaveLength(0);
      mode = 'wrong-node'; expect(await owner.run({ ...context, phase: 'stop' })).toMatchObject({ kind: 'waiting' });
      expect(await f.database.db.execute('SELECT id FROM session.connection_births WHERE exited_at IS NOT NULL')).toHaveLength(0);
      mode = 'original-pod'; expect((await owner.run({ ...context, phase: 'stop' })).kind).toBe('done');
      const row = (await f.database.db.execute<{ identity: string; exit_digest: string; recovery_digest: string }>('SELECT identity,exit_digest,recovery_digest FROM session.connection_births'))[0]!;
      expect(row.identity).toBe(birth.identity); expect(row.exit_digest).toBe(birth.identity); expect(row.recovery_digest).toBe(jsonHash('complete original Pod stop'));
      await history.exit(birth, key);
      await expect(f.database.db.execute('UPDATE session.process_stops SET digest=repeat(\'0\',64)').then(() => undefined)).rejects.toMatchObject({ cause: { message: expect.stringContaining('observer') } });
      for (const phase of PROJECT_DELETION_PHASES.slice(2)) expect((await owner.run({ ...context, phase })).kind).toBe('done');
      expect(await f.database.db.execute('SELECT id FROM session.connection_births')).toHaveLength(0);
      expect((await owner.inspect(f.target)).resources).toEqual([]);
    } finally { await f.drop(); }
  });
  test('an unbound original birth cannot acquire a later Pod identity or be recovered by an unrelated physical stop', async () => {
    const process = { podUid: Bun.randomUUIDv7(), containerId: 'containerd://' + 'b'.repeat(64), nodeUid: Bun.randomUUIDv7(), nodeName: 'node',
      pid: 1, pidNamespace: '456', bootId: Bun.randomUUIDv7(), startTicks: '91' };
    let releasable = false;
    const f = await sessionDeletionFixture({ protectCurrent: async () => process, sweep: async (accept) => {
      await accept.podStopped({ podUid: process.podUid, nodeUid: process.nodeUid, nodeName: process.nodeName }, jsonHash('unrelated Pod stop')); releasable = await accept.releasable(process.podUid);
    } });
    try {
      const task = f.task(), history = sessionConnectionHistory(f.database.db, { ...f.source, processes: undefined }), key = 'unbound private key';
      const birth = await history.open(task, () => history.birth({ id: newResourceId(), taskId: task, replica: 'http://127.0.0.1:1', at: new Date().toISOString(), exitKeyHash: jsonHash(key) }));
      const context = await f.context(), owner = f.first.module.api.deletionOwner!;
      expect((await owner.run(context)).kind).toBe('done'); expect(await owner.run({ ...context, phase: 'stop' })).toMatchObject({ kind: 'waiting' });
      await expect(f.database.db.execute(sql`UPDATE session.connection_births SET original_process=${JSON.stringify(process)}::jsonb,exited_at=now(),exit_digest=identity,recovery_digest=${jsonHash('unrelated Pod stop')} WHERE id=${birth.id}`).then(() => undefined))
        .rejects.toMatchObject({ cause: { message: expect.stringContaining('original birth') } });
      expect(releasable).toBe(true); expect(await f.database.db.execute('SELECT id FROM session.connection_births WHERE exited_at IS NOT NULL')).toHaveLength(0);
      await history.exit(birth, key); expect((await owner.run({ ...context, phase: 'stop' })).kind).toBe('done');
    } finally { await f.drop(); }
  });
});
