import { describe, expect, test } from 'bun:test';
import { ProjectDeletionSessionDataSchema, TaskIdSchema } from '@crewstation/contracts';
import { createProjectDeletionSessionClient, projectDeletionMeasurement } from '../../../../packages/session-client';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { drizzleBusinessUsageSourceStore } from '../../adapters/persistence/businessUsageSources';
import { drizzleDevelopmentUsageStore } from '../../adapters/persistence/developmentUsage';
import { sessionWorkHistory } from '../../adapters/persistence/deletion/workHistory';
import { sessionProjectWork } from '../../adapters/persistence/deletion/projectWork';
import { jsonHash } from '@crewstation/kernel';
import { developmentAt, developmentCapture } from '../developmentUsageFixtures';
import { cleanupFixture } from './cleanupFixture';
import { loopbackRequest } from './request';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('deletion Session data client (real PG and two internal HTTP replicas; controlled Root ownership)', () => {
  test('sealed original pages replay until acknowledged, preserve large usage integers and exclude ordinary consumers', async () => {
    const f = await cleanupFixture();
    try {
      const development = drizzleDevelopmentUsageStore(f.database.db);
      await development.ingest(f.task, f.developmentReceipt(7), f.developmentPage(0, 5));
      await development.ingest(f.task, f.developmentReceipt(7), f.developmentPage(5, 2));
      const events = Array.from({ length: 8 }, (_, index) => ({ sequence: index + 1, occurredAt: developmentAt,
        frame: { type: 'agent' as const, event: { agentId: 'agent', seq: index + 1, at: developmentAt, type: 'usage' as const, usageCapture: developmentCapture(index + 1) } } }));
      await f.business.ingest(f.task, { ...f.receipt, phase: 'running', lastSequence: 8 }, events);
      const context = { ...f.context, confirmed: await f.owner.inspect(f.target) };
      const client = createProjectDeletionSessionClient(f.first.address, loopbackRequest)(context, f.task);
      await expect(client.offerBusiness(f.receipt.executionId)).rejects.toThrow('原操作');
      expect((await f.owner.run({ ...context, phase: 'seal' })).kind).toBe('done'); f.deleting();
      expect(await drizzleBusinessUsageSourceStore(f.database.db).next()).toBeUndefined();
      expect(await client.getBusinessExecution(f.task, f.receipt.executionId)).toMatchObject({ persistedThrough: 8 });
      expect(await client.originalBusiness()).toMatchObject([{ executionId: f.receipt.executionId, lastSequence: 8 }]);
      expect(await client.originalBusiness('zzzz')).toEqual([]);
      expect(await client.listBusinessExecutionEvents(f.task, f.receipt.executionId, 0, 3)).toEqual(events.slice(0, 3));
      expect(await client.data({ type: 'business-completion', executionId: f.receipt.executionId })).toBeNull();
      await expect(client.consumeBusinessExecution(f.task, f.receipt.executionId, 8)).rejects.toThrow('完整投影');
      await expect(client.consumeBusinessExecution(f.task, f.receipt.executionId, 8, true)).rejects.toThrow('原容器停止证明');
      const first = (await client.offerBusiness(f.receipt.executionId))!;
      expect(first).toMatchObject({ after: 0, through: 5, runtimeTaskId: f.task, incarnation: f.receipt.incarnation });
      expect(await client.offerBusiness(f.receipt.executionId)).toEqual(first);
      const measurement = projectDeletionMeasurement(await client.data({ type: 'business-measurement', executionId: f.receipt.executionId, recordId: 'step-1', revision: 1 }));
      expect(measurement?.usage.input).toBe('9007199254740993');
      expect(projectDeletionMeasurement(await client.data({ type: 'business-measurement', executionId: f.receipt.executionId, recordId: 'missing', revision: 1 }))).toBeNull();
      await expect(client.acknowledgeBusiness(f.receipt.executionId, 8)).rejects.toThrow('尚未读取');
      await client.acknowledgeBusiness(f.receipt.executionId, 5);
      const second = (await client.offerBusiness(f.receipt.executionId))!; expect(second).toMatchObject({ after: 5, through: 8 });
      await client.acknowledgeBusiness(f.receipt.executionId, 8); expect(await client.offerBusiness(f.receipt.executionId)).toBeNull();

      expect(await client.lookupDevelopmentUsage(f.task)).toMatchObject({ kind: 'registered', stored: { persistedThrough: 7 } });
      expect(await client.registerDevelopmentUsage(f.registration)).toMatchObject({ persistedThrough: 7 });
      await expect(client.registerDevelopmentUsage({ ...f.registration, podUid: 'replacement' })).rejects.toThrow('新增或替换');
      expect(await client.getDevelopmentUsage(f.task, f.registration.key)).toMatchObject({ sourceAcknowledgedThrough: 0 });
      const page = (await client.offerDevelopment(f.registration.key))!;
      expect(await client.offerDevelopment(f.registration.key)).toEqual(page);
      const developmentMeasurement = projectDeletionMeasurement(await client.data({ type: 'development-measurement', key: f.registration.key, recordId: 'step-1', revision: 1 }));
      expect(developmentMeasurement?.usage.input).toBe('9007199254740993');
      await expect(client.acknowledgeDevelopment(f.registration.key, page.through + 1)).rejects.toThrow('完整数字页');
      await client.acknowledgeDevelopment(f.registration.key, page.through);
      const finalDevelopment = (await client.offerDevelopment(f.registration.key))!;
      await client.acknowledgeDevelopment(f.registration.key, finalDevelopment.through); expect(await client.offerDevelopment(f.registration.key)).toBeNull();
      expect(await client.requestDevelopmentUsageDrain(f.task, f.registration.key, 'cancelled')).toMatchObject({ drainReason: 'cancelled', closure: null });

      const transports = await client.transports(); expect(transports).toEqual([{ id: f.birth, taskId: f.task, replica: f.second.address }]);
      const command = { id: f.commandId(), type: 'getBusinessExecution' as const, executionId: f.receipt.executionId };
      const pending = client.send(transports[0]!, command);
      await f.runner.next((frame) => frame.id === command.id);
      f.runner.ws.send(JSON.stringify({ type: 'result', id: command.id, payload: { ...f.receipt, phase: 'running', lastSequence: 8 } }));
      expect(await pending).toMatchObject({ lastSequence: 8 });
      const history = await sessionWorkHistory(f.database.db, f.projectId);
      expect(history.length).toBeGreaterThan(20); expect(history.every((row) => row.kind === 'cleanup' && row.exited)).toBe(true);
      expect((await f.owner.run(context)).kind).toBe('done'); await f.runner.closed;
      await expect(client.offerBusiness(f.receipt.executionId)).rejects.toThrow('停止阶段已经完成');
    } finally { await f.drop(); }
  });

  test('a current grant and the exact sealed task are required; malformed operations cannot fabricate loss or physical termination', async () => {
    const f = await cleanupFixture();
    try {
      const other = f.newTask(f.otherProject), context = f.context;
      expect((await f.owner.run({ ...context, phase: 'seal' })).kind).toBe('done'); f.deleting();
      const connect = createProjectDeletionSessionClient(f.first.address, loopbackRequest), client = connect(context, f.task);
      await expect(connect(context, other).lookupDevelopmentUsage(other)).rejects.toThrow('原封写范围');
      await expect(connect({ ...context, phase: 'purge' }, f.task).lookupDevelopmentUsage(f.task)).rejects.toThrow('停止许可');
      f.permit(false); await expect(client.lookupDevelopmentUsage(f.task)).rejects.toThrow('grant unavailable'); f.permit(true);
      await expect(client.getDevelopmentUsage(TaskIdSchema.parse(other), f.registration.key)).rejects.toThrow('只能使用原任务');
      await expect(client.data({ type: 'development-read', key: { ...f.registration.key, executionId: other } })).rejects.toThrow('不属于原任务');
      await expect(client.data({ type: 'development-source', key: { ...f.registration.key, journalId: crypto.randomUUID() } })).rejects.toThrow('原受理不同');
      await expect(client.offerBusiness('replacement')).rejects.toThrow('来源尚未装配或已经变化');
      await expect(client.data({ type: 'business-measurement', executionId: 'replacement', recordId: 'step', revision: 1 })).rejects.toThrow('原数字执行已经变化');
      expect(ProjectDeletionSessionDataSchema.safeParse({ type: 'business-consume', executionId: f.receipt.executionId, through: 0, stopped: true }).success).toBe(false);
      expect(ProjectDeletionSessionDataSchema.safeParse({ type: 'development-unavailable', key: f.registration.key }).success).toBe(false);
      const malformed = await loopbackRequest(f.first.address + '/internal/project-deletion/data', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context, taskId: f.task, operation: { type: 'development-lookup', newTask: other } }) }); expect(malformed.status).toBe(400);
      expect(await f.database.db.execute(sql`SELECT task_id FROM session.business_stopped_executions WHERE task_id=${f.task}`)).toHaveLength(0);
      expect(await f.second.module.api.getDevelopmentUsage(f.task, f.registration.key)).toMatchObject({ closure: null, loss: null, sourceAcknowledgedThrough: 0 });
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
