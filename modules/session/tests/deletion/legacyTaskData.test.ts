import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { jsonHash } from '@crewstation/kernel';
import type { RunnerBusinessEvent, RunnerBusinessReceipt } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { createProjectDeletionSessionClient } from '../../../../packages/session-client';
import { sessionDeletionFixture } from './fixture';
import { loopbackRequest } from './request';

const at = '2026-10-03T00:00:00.000Z';
const available = await testDatabaseAvailable();
describe.skipIf(!available)('original legacy task data (real PG and internal HTTP; controlled immutable ownership)', () => {
  test('a retained numeric storage key drains under its canonical owner without moving rows or rewriting the original receipt', async () => {
    const processIdentity = { podUid: crypto.randomUUID(), containerId: 'containerd://' + 'a'.repeat(64), nodeUid: crypto.randomUUID(), nodeName: 'legacy-session-node',
      pid: process.pid, pidNamespace: '173', bootId: crypto.randomUUID(), startTicks: '91' };
    const f = await sessionDeletionFixture({ protectCurrent: async () => processIdentity, sweep: async () => {} });
    try {
      const task = f.task(), legacy = '417', origin = f.origins.get(task)!;
      f.origins.set(legacy, origin);
      const result = { reason: 'exited' as const, exitCode: 0, durationMs: 90000 };
      const receipt: RunnerBusinessReceipt = { executionId: 'original-legacy-business', attempt: 1, incarnation: crypto.randomUUID(), payloadDigest: jsonHash('old command'),
        phase: 'finished', lastSequence: 2, acknowledgedSequence: 0, outputBytes: 0, result };
      const event: RunnerBusinessEvent = { sequence: 1, occurredAt: at, frame: { type: 'output', stream: 'stdout', text: 'original output' } };
      const final: RunnerBusinessEvent = { sequence: 2, occurredAt: at, frame: { type: 'result', result } };
      await f.database.db.execute(sql`INSERT INTO session.business_executions(task_id,execution_id,receipt,persisted_through,complete) VALUES(${legacy},${receipt.executionId},${JSON.stringify(receipt)}::jsonb,2,true)`);
      for (const item of [event, final]) await f.database.db.execute(sql`INSERT INTO session.business_execution_events(task_id,execution_id,sequence,digest,event) VALUES(${legacy},${receipt.executionId},${item.sequence},${jsonHash(item)},${JSON.stringify(item)}::jsonb)`);
      const retainedProof = { taskId: legacy, executionId: receipt.executionId, attempt: 1, incarnation: receipt.incarnation, payloadDigest: receipt.payloadDigest,
        lastSequence: 2, resultDigest: jsonHash(result), complete: true, persistedAt: at };
      await f.database.db.execute(sql`INSERT INTO session.execution_completion_proofs(task_id,execution_id,record) VALUES(${legacy},${receipt.executionId},${JSON.stringify(retainedProof)}::jsonb)`);
      const context = await f.context(), owner = f.first.module.api.deletionOwner!;
      expect(context.confirmed.complete).toBe(true); expect((await owner.run(context)).kind).toBe('done'); f.deleting();
      const stopped = { ...context, phase: 'stop' as const }, connect = createProjectDeletionSessionClient(f.first.address, loopbackRequest), client = connect(stopped, task);
      expect(await connect.tasks(stopped)).toEqual([task]);
      expect(await client.originalBusiness()).toEqual([receipt]);
      expect(await client.getBusinessExecution(task, receipt.executionId)).toMatchObject({ taskId: task, complete: true, persistedThrough: 2 });
      expect(await client.listBusinessExecutionEvents(task, receipt.executionId, 0, 10)).toEqual([event, final]);
      await client.consumeBusinessExecution(task, receipt.executionId, 2);
      expect(await client.data({ type: 'business-completion', executionId: receipt.executionId })).toMatchObject({ taskId: task, lastSequence: 2, complete: true });
      expect((await f.database.db.execute<{ record: unknown }>(sql`SELECT record FROM session.execution_completion_proofs WHERE task_id=${legacy}`))[0]?.record).toEqual(retainedProof);
      const rows = await f.database.db.execute<{ task_id: string; receipt: unknown }>(sql`SELECT task_id,receipt FROM session.business_executions`);
      expect([...rows]).toEqual([{ task_id: legacy, receipt }]);
      expect([...await f.database.db.execute<{ task_key: string; exited: boolean }>(sql`SELECT task_key,exited_at IS NOT NULL AS exited FROM session.original_callbacks`)].every((row) => row.task_key === legacy && row.exited)).toBe(true);
      f.permit(false); await expect(client.getBusinessExecution(task, receipt.executionId)).rejects.toThrow('grant unavailable'); f.permit(true);
      expect((await owner.run(stopped)).kind).toBe('done'); await expect(client.getBusinessExecution(task, receipt.executionId)).rejects.toThrow('停止阶段已经完成');
    } finally { f.permit(true); await f.drop(); }
  }, 20_000);
  test('two retained storage keys for one task remain blocked, so no business copy can disappear from the canonical directory', async () => {
    const f = await sessionDeletionFixture();
    try {
      const task = f.task(); f.origins.set('418', f.origins.get(task)!);
      for (const key of [task, '418']) await f.database.db.execute(sql`INSERT INTO session.business_executions(task_id,execution_id,receipt) VALUES(${key},'execution','{}'::jsonb)`);
      const context = await f.context(); expect((await f.first.module.api.deletionOwner!.run(context)).kind).toBe('done');
      await expect(createProjectDeletionSessionClient(f.first.address, loopbackRequest).tasks(context)).rejects.toThrow('不能证明排空');
      expect(await f.database.db.execute(sql`SELECT task_id FROM session.business_executions`)).toHaveLength(2);
    } finally { await f.drop(); }
  });
});
