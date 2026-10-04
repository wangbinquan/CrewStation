import { describe, expect, test } from 'bun:test';
import { PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { sessionWorkHistory } from '../../adapters/persistence/deletion/workHistory';
import { cleanupFixture } from './cleanupFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('private Session business cleanup (real PG, two WS replicas and actual internal HTTP; controlled ownership/Runner replies)', () => {
  test('the sealed original birth can cancel, read every original page and ACK only the committed watermark before stop snapshots and atomic metadata removal', async () => {
    const f = await cleanupFixture();
    try {
      expect((await f.owner.run({ ...f.context, phase: 'seal' })).kind).toBe('done'); f.deleting();
      const running = { ...f.receipt, phase: 'running' as const, lastSequence: 2 };
      const cancel = { id: f.commandId(), type: 'cancelBusinessExecution' as const, executionId: f.receipt.executionId,
        registration: { attempt: f.receipt.attempt, incarnation: f.receipt.incarnation, payloadDigest: f.receipt.payloadDigest } };
      // The private wire skips ordinary re-registration, but the original Runner still needs the cancellation identity.
      expect((await f.exchange(cancel, running)).frame).toMatchObject({ registration: cancel.registration });
      expect(await f.business.get(f.task, f.receipt.executionId)).toMatchObject({ receipt: running, persistedThrough: 0 });
      await f.exchange({ id: f.commandId(), type: 'getBusinessExecution', executionId: running.executionId }, running);
      const before = f.runner.frames.length;
      await expect(f.request({ id: f.commandId(), type: 'ackBusinessExecutionEvents', executionId: running.executionId, through: 2 })).rejects.toMatchObject({ kind: 'unavailable' });
      expect(f.runner.frames.length).toBe(before);
      for (let i = 0; i < 2; i++) {
        const page = [{ sequence: i + 1, occurredAt: '2026-10-04T01:00:00Z', frame: { type: 'state', state: 'running' } }];
        await f.exchange({ id: f.commandId(), type: 'readBusinessExecutionEvents', executionId: running.executionId, after: i, limit: 1 }, page);
        expect(await f.business.get(f.task, running.executionId)).toMatchObject({ persistedThrough: i + 1 });
      }
      await expect(f.exchange({ id: f.commandId(), type: 'ackBusinessExecutionEvents', executionId: running.executionId, through: 2 }, { acknowledgedSequence: 2 })).rejects.toMatchObject({ kind: 'unavailable' });
      expect(await f.business.get(f.task, running.executionId)).toMatchObject({ persistedThrough: 2, acknowledgedThrough: 0 });
      // The actual Runner returns {} for a successful business ACK; it does not return a new execution receipt.
      await f.exchange({ id: f.commandId(), type: 'ackBusinessExecutionEvents', executionId: running.executionId, through: 2 }, {});
      expect(await f.business.get(f.task, running.executionId)).toMatchObject({ persistedThrough: 2, acknowledgedThrough: 2 });
      const callbacks = await sessionWorkHistory(f.database.db, f.projectId);
      expect(callbacks.length).toBe(7); expect(callbacks.every((callback) => callback.kind === 'cleanup' && callback.exited && callback.grant?.revision === f.context.confirmed.revision)).toBe(true);
      expect((await f.owner.run(f.context)).kind).toBe('done'); await f.runner.closed;
      const row = (await f.database.db.execute<{ body: { stopped: { tables: unknown[]; count: number }; taskKeys: string[] } }>('SELECT body FROM session.project_deletions'))[0]!;
      expect(row.body.stopped.tables).toHaveLength(12); expect(row.body.stopped.count).toBeGreaterThan(f.context.confirmed.resources.length);
      const frozen = jsonHash(row.body.stopped);
      await expect(f.request({ id: f.commandId(), type: 'getBusinessExecution', executionId: running.executionId })).rejects.toThrow('停止阶段已经完成');
      for (const phase of PROJECT_DELETION_PHASES.slice(2)) expect((await f.owner.run({ ...f.context, phase })).kind).toBe('done');
      expect(await f.database.db.execute(sql`SELECT task_id FROM session.business_execution_events WHERE task_id=${f.task}`)).toHaveLength(0);
      expect(await f.database.db.execute('SELECT id FROM session.original_callbacks')).toHaveLength(0);
      const retained = (await f.database.db.execute<{ body: { stopped: unknown; callbacks: unknown[]; taskKeys: unknown[] } }>('SELECT body FROM session.project_deletions'))[0]!.body;
      expect(retained.callbacks).toEqual([]); expect(retained.taskKeys).toEqual([]); expect(jsonHash(retained.stopped)).toBe(frozen);
    } finally { await f.drop(); }
  });

  test('no seal, another birth, stale phase, replaced execution, new work and revoked current grants produce no Runner command or numeric write', async () => {
    const f = await cleanupFixture();
    try {
      await expect(f.request({ id: f.commandId(), type: 'getBusinessExecution', executionId: f.receipt.executionId })).rejects.toThrow('原操作');
      expect((await f.owner.run({ ...f.context, phase: 'seal' })).kind).toBe('done'); f.deleting();
      const frames = f.runner.frames.length;
      await expect(f.second.module.api.sendCommand(f.task, { id: f.commandId(), type: 'previewStatus' })).rejects.toThrow('project deleting');
      await expect(f.first.module.api.sendProjectDeletionCommand!({ ...f.context, phase: 'purge' }, f.birth, { id: f.commandId(), type: 'getBusinessExecution', executionId: f.receipt.executionId })).rejects.toThrow('stop');
      await expect(f.first.module.api.sendProjectDeletionCommand!(f.context, newResourceId(), { id: f.commandId(), type: 'getBusinessExecution', executionId: f.receipt.executionId })).rejects.toThrow('原连接');
      await expect(f.request({ id: f.commandId(), type: 'exec', execId: 'new', command: ['sh'], env: {}, timeoutSeconds: 5, wait: true })).rejects.toMatchObject({ kind: 'unavailable' });
      await expect(f.request({ id: f.commandId(), type: 'getBusinessExecution', executionId: 'replacement' })).rejects.toMatchObject({ kind: 'unavailable' });
      expect(f.runner.frames.length).toBe(frames);
      const command = { id: f.commandId(), type: 'getBusinessExecution' as const, executionId: f.receipt.executionId };
      const pending = f.request(command).catch((error: unknown) => error);
      await f.runner.next((frame) => frame.id === command.id); f.permit(false);
      f.runner.ws.send(JSON.stringify({ type: 'result', id: command.id, payload: { ...f.receipt, phase: 'running', lastSequence: 1 } }));
      expect(await pending).toMatchObject({ kind: 'unavailable' });
      expect(await f.business.get(f.task, f.receipt.executionId)).toMatchObject({ receipt: f.receipt, persistedThrough: 0 });
      expect((await sessionWorkHistory(f.database.db, f.projectId)).every((callback) => callback.exited)).toBe(true);
      f.permit(true); expect((await f.owner.run(f.context)).kind).toBe('done');
    } finally { f.permit(true); await f.drop(); }
  });
});
