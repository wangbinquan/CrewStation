import { describe, expect, test } from 'bun:test';
import { ProjectDeletionSessionDataSchema, TaskIdSchema } from '@crewstation/contracts';
import { createProjectDeletionSessionClient } from '../../../../packages/session-client';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { sessionWorkHistory } from '../../adapters/persistence/deletion/workHistory';
import { sessionProjectWork } from '../../adapters/persistence/deletion/projectWork';
import { jsonHash } from '@crewstation/kernel';
import { cleanupFixture } from './cleanupFixture';
import { loopbackRequest } from './request';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('deletion Session data client (real PG and two internal HTTP replicas; controlled Root ownership)', () => {
  test('sealed original business pages are read through the private client; transports reach only the original connection', async () => {
    const f = await cleanupFixture();
    try {
      const at = new Date().toISOString();
      const events = Array.from({ length: 8 }, (_, index) => ({ sequence: index + 1, occurredAt: at,
        frame: { type: 'output' as const, stream: 'stdout' as const, text: 'line-' + (index + 1) } }));
      await f.business.ingest(f.task, { ...f.receipt, phase: 'running', lastSequence: 8 }, events);
      const context = { ...f.context, confirmed: await f.owner.inspect(f.target) };
      const client = createProjectDeletionSessionClient(f.first.address, loopbackRequest)(context, f.task);
      expect((await f.owner.run({ ...context, phase: 'seal' })).kind).toBe('done'); f.deleting();
      expect(await client.getBusinessExecution(f.task, f.receipt.executionId)).toMatchObject({ persistedThrough: 8 });
      expect(await client.originalBusiness()).toMatchObject([{ executionId: f.receipt.executionId, lastSequence: 8 }]);
      expect(await client.originalBusiness('zzzz')).toEqual([]);
      expect(await client.listBusinessExecutionEvents(f.task, f.receipt.executionId, 0, 3)).toEqual(events.slice(0, 3));
      expect(await client.data({ type: 'business-completion', executionId: f.receipt.executionId })).toBeNull();
      await expect(client.consumeBusinessExecution(f.task, f.receipt.executionId, 8, true)).rejects.toThrow('原容器停止证明');

      const transports = await client.transports(); expect(transports).toEqual([{ id: f.birth, taskId: f.task, replica: f.second.address }]);
      const command = { id: f.commandId(), type: 'getBusinessExecution' as const, executionId: f.receipt.executionId };
      const pending = client.send(transports[0]!, command);
      await f.runner.next((frame) => frame.id === command.id);
      f.runner.ws.send(JSON.stringify({ type: 'result', id: command.id, payload: { ...f.receipt, phase: 'running', lastSequence: 8 } }));
      expect(await pending).toMatchObject({ lastSequence: 8 });
      const history = await sessionWorkHistory(f.database.db, f.projectId);
      expect(history.length).toBeGreaterThan(5); expect(history.every((row) => row.kind === 'cleanup' && row.exited)).toBe(true);
      expect((await f.owner.run(context)).kind).toBe('done'); await f.runner.closed;
      await expect(client.getBusinessExecution(f.task, f.receipt.executionId)).rejects.toThrow('停止阶段已经完成');
    } finally { await f.drop(); }
  });

  test('a current grant and the exact sealed task are required; retired usage operations no longer exist', async () => {
    const f = await cleanupFixture();
    try {
      const other = f.newTask(f.otherProject), context = f.context;
      expect((await f.owner.run({ ...context, phase: 'seal' })).kind).toBe('done'); f.deleting();
      const connect = createProjectDeletionSessionClient(f.first.address, loopbackRequest), client = connect(context, f.task);
      await expect(connect(context, other).getBusinessExecution(other, f.receipt.executionId)).rejects.toThrow('原封写范围');
      await expect(connect({ ...context, phase: 'purge' }, f.task).getBusinessExecution(f.task, f.receipt.executionId)).rejects.toThrow('停止许可');
      f.permit(false); await expect(client.getBusinessExecution(f.task, f.receipt.executionId)).rejects.toThrow('grant unavailable'); f.permit(true);
      await expect(client.getBusinessExecution(TaskIdSchema.parse(other), f.receipt.executionId)).rejects.toThrow('只能使用原任务');
      expect(ProjectDeletionSessionDataSchema.safeParse({ type: 'business-consume', executionId: f.receipt.executionId, through: 0, stopped: true }).success).toBe(false);
      for (const type of ['development-lookup', 'business-source', 'business-measurement']) expect(ProjectDeletionSessionDataSchema.safeParse({ type, executionId: 'x' }).success).toBe(false);
      const malformed = await loopbackRequest(f.first.address + '/internal/project-deletion/data', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context, taskId: f.task, operation: { type: 'development-lookup', newTask: other } }) }); expect(malformed.status).toBe(400);
      expect(await f.database.db.execute(sql`SELECT task_id FROM session.business_stopped_executions WHERE task_id=${f.task}`)).toHaveLength(0);
    } finally { f.permit(true); await f.drop(); }
  });
  test('even a private cleanup callback cannot change the original business attempt, incarnation or payload digest', async () => {
    const f = await cleanupFixture(), work = sessionProjectWork(f.database.db, f.source);
    try {
      expect((await f.owner.run({ ...f.context, phase: 'seal' })).kind).toBe('done'); f.deleting();
      for (const receipt of [{ ...f.receipt, attempt: 2 }, { ...f.receipt, incarnation: crypto.randomUUID() }, { ...f.receipt, payloadDigest: 'f'.repeat(64) }]) {
        await expect(work.runGranted(f.context, { taskKey: f.task, kind: 'cleanup', reference: f.commandId(), inputDigest: jsonHash(receipt) },
          () => work.database.execute(sql`UPDATE session.business_executions SET receipt=${JSON.stringify(receipt)}::jsonb WHERE task_id=${f.task}`))).rejects.toThrow();
      }
      expect((await f.business.get(f.task, f.receipt.executionId))?.receipt).toEqual(f.receipt);
    } finally { await work.drain(); await f.drop(); }
  });
  test('private original enumeration reads beyond the ordinary page and reaches actual EOF after sealing', async () => {
    const f = await cleanupFixture();
    try {
      const ids: string[] = [f.receipt.executionId];
      for (let i = 0; i < 101; i++) {
        const executionId = crypto.randomUUID(); ids.push(executionId);
        await f.business.register(f.task, { ...f.receipt, executionId });
      }
      const context = { ...f.context, confirmed: await f.owner.inspect(f.target) };
      expect((await f.owner.run({ ...context, phase: 'seal' })).kind).toBe('done'); f.deleting();
      const client = createProjectDeletionSessionClient(f.first.address, loopbackRequest)(context, f.task);
      expect(await f.business.pending([f.task], 100)).toEqual([]);
      const first = await client.originalBusiness(), second = await client.originalBusiness(first.at(-1)!.executionId);
      expect(first).toHaveLength(100); expect(second).toHaveLength(2);
      expect(new Set([...first, ...second].map((receipt) => receipt.executionId))).toEqual(new Set(ids));
      expect(await client.originalBusiness(second.at(-1)!.executionId)).toEqual([]);
      expect(() => client.data({ type: 'business-originals', after: '' })).toThrow();
    } finally { await f.drop(); }
  });
});
