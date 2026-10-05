import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { jsonHash } from '@crewstation/kernel';
import type { RunnerBusinessEvent, RunnerBusinessReceipt } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { createProjectDeletionSessionClient, projectDeletionMeasurement } from '../../../../packages/session-client';
import { developmentAt, developmentCapture, developmentEvents, developmentReceipt, developmentRegistration } from '../developmentUsageFixtures';
import { sessionDeletionFixture } from './fixture';
import { loopbackRequest } from './request';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('original legacy task data (real PG and internal HTTP; controlled immutable ownership)', () => {
  test('a retained numeric storage key drains under its canonical owner without moving rows or rewriting the original registration', async () => {
    const processIdentity = { podUid: crypto.randomUUID(), containerId: 'containerd://' + 'a'.repeat(64), nodeUid: crypto.randomUUID(), nodeName: 'legacy-session-node',
      pid: process.pid, pidNamespace: '173', bootId: crypto.randomUUID(), startTicks: '91' };
    const f = await sessionDeletionFixture({ protectCurrent: async () => processIdentity, sweep: async () => {} });
    try {
      const task = f.task(), legacy = '417', origin = f.origins.get(task)!;
      f.origins.set(legacy, origin);
      const result = { reason: 'exited' as const, exitCode: 0, durationMs: 90000 };
      const receipt: RunnerBusinessReceipt = { executionId: 'original-legacy-business', attempt: 1, incarnation: crypto.randomUUID(), payloadDigest: jsonHash('old command'),
        phase: 'finished', lastSequence: 2, acknowledgedSequence: 0, outputBytes: 0, result };
      const event: RunnerBusinessEvent = { sequence: 1, occurredAt: developmentAt, frame: { type: 'agent', event: { agentId: 'original-agent', seq: 1, at: developmentAt, type: 'usage', usageCapture: developmentCapture(1) } } };
      const final: RunnerBusinessEvent = { sequence: 2, occurredAt: developmentAt, frame: { type: 'result', result } };
      await f.database.db.execute(sql`INSERT INTO session.business_executions(task_id,execution_id,receipt,persisted_through,complete) VALUES(${legacy},${receipt.executionId},${JSON.stringify(receipt)}::jsonb,2,true)`);
      for (const item of [event, final]) await f.database.db.execute(sql`INSERT INTO session.business_execution_events(task_id,execution_id,sequence,digest,event) VALUES(${legacy},${receipt.executionId},${item.sequence},${jsonHash(item)},${JSON.stringify(item)}::jsonb)`);
      await f.database.db.execute(sql`INSERT INTO session.business_usage_sources(task_id,execution_id,attempt,incarnation,payload_digest) VALUES(${legacy},${receipt.executionId},1,${receipt.incarnation},${receipt.payloadDigest})`);
      await f.database.db.execute(sql`INSERT INTO session.business_usage_events(task_id,execution_id,sequence,agent_id,occurred_at,capture) VALUES(${legacy},${receipt.executionId},1,'original-agent',${developmentAt},${JSON.stringify(developmentCapture(1))}::jsonb)`);
      const retainedProof = { taskId: legacy, executionId: receipt.executionId, attempt: 1, incarnation: receipt.incarnation, payloadDigest: receipt.payloadDigest,
        lastSequence: 2, resultDigest: jsonHash(result), complete: true, persistedAt: developmentAt };
      await f.database.db.execute(sql`INSERT INTO session.execution_completion_proofs(task_id,execution_id,record) VALUES(${legacy},${receipt.executionId},${JSON.stringify(retainedProof)}::jsonb)`);
      const registration = developmentRegistration();
      registration.runtimeTaskId = task; registration.key.executionId = task; registration.identity.executionId = task; registration.identity.projectId = f.projectId;
      const retained = { ...registration, runtimeTaskId: legacy, key: { ...registration.key, executionId: legacy }, identity: { ...registration.identity, executionId: legacy } };
      const development = developmentReceipt(registration, 2, { phase: 'finished', result: 'completed', finalThrough: 2 });
      const retainedReceipt = { ...development, key: retained.key, identity: retained.identity };
      await f.database.db.execute(sql`INSERT INTO session.development_usage_streams(task_id,registration,receipt,persisted_through,complete) VALUES(${legacy},${JSON.stringify(retained)}::jsonb,${JSON.stringify(retainedReceipt)}::jsonb,2,true)`);
      for (const item of developmentEvents(0, 2)) await f.database.db.execute(sql`INSERT INTO session.development_usage_events(task_id,sequence,digest,event) VALUES(${legacy},${item.sequence},${jsonHash(item)},${JSON.stringify(item)}::jsonb)`);
      const context = await f.context(), owner = f.first.module.api.deletionOwner!;
      expect(context.confirmed.complete).toBe(true); expect((await owner.run(context)).kind).toBe('done'); f.deleting();
      const stopped = { ...context, phase: 'stop' as const }, connect = createProjectDeletionSessionClient(f.first.address, loopbackRequest), client = connect(stopped, task);
      expect(await connect.tasks(stopped)).toEqual([task]);
      expect(await client.originalBusiness()).toEqual([receipt]);
      expect(await client.getBusinessExecution(task, receipt.executionId)).toMatchObject({ taskId: task, complete: true, persistedThrough: 2 });
      expect(await client.listBusinessExecutionEvents(task, receipt.executionId, 0, 10)).toEqual([event, final]);
      const page = (await client.offerBusiness(receipt.executionId))!; expect(page).toMatchObject({ runtimeTaskId: task, through: 1 });
      expect(await client.offerBusiness(receipt.executionId)).toEqual(page);
      expect(projectDeletionMeasurement(await client.data({ type: 'business-measurement', executionId: receipt.executionId, recordId: 'step-1', revision: 1 }))?.usage.input).toBe('9007199254740993');
      await client.acknowledgeBusiness(receipt.executionId, page.through); expect(await client.offerBusiness(receipt.executionId)).toBeNull();
      await client.consumeBusinessExecution(task, receipt.executionId, 2);
      expect(await client.data({ type: 'business-completion', executionId: receipt.executionId })).toMatchObject({ taskId: task, lastSequence: 2, complete: true });
      expect((await f.database.db.execute<{ record: unknown }>(sql`SELECT record FROM session.execution_completion_proofs WHERE task_id=${legacy}`))[0]?.record).toEqual(retainedProof);
      expect(await client.lookupDevelopmentUsage(task)).toMatchObject({ kind: 'registered', stored: { registration, persistedThrough: 2 } });
      expect(await client.registerDevelopmentUsage(registration)).toMatchObject({ registration });
      expect(await client.getDevelopmentUsage(task, registration.key)).toMatchObject({ receipt: development });
      const numbers = (await client.offerDevelopment(registration.key))!; expect(numbers.key).toEqual(registration.key);
      expect(await client.offerDevelopment(registration.key)).toEqual(numbers);
      await client.acknowledgeDevelopment(registration.key, numbers.through); expect(await client.offerDevelopment(registration.key)).toBeNull();
      expect(projectDeletionMeasurement(await client.data({ type: 'development-measurement', key: registration.key, recordId: 'step-2', revision: 2 }))?.usage.input).toBe('9007199254740993');
      expect(await client.requestDevelopmentUsageDrain(task, registration.key, 'cancelled')).toMatchObject({ closure: { status: 'complete', persistedThrough: 2 } });
      const rows = await f.database.db.execute<{ task_id: string; registration: unknown }>(sql`SELECT task_id,registration FROM session.development_usage_streams`);
      expect([...rows]).toEqual([{ task_id: legacy, registration: retained }]);
      expect(await f.database.db.execute(sql`SELECT task_id FROM session.business_executions WHERE task_id=${task}`)).toHaveLength(0);
      expect([...await f.database.db.execute<{ task_key: string; exited: boolean }>(sql`SELECT task_key,exited_at IS NOT NULL AS exited FROM session.original_callbacks`)].every((row) => row.task_key === legacy && row.exited)).toBe(true);
      f.permit(false); await expect(client.offerBusiness(receipt.executionId)).rejects.toThrow('grant unavailable'); f.permit(true);
      expect((await owner.run(stopped)).kind).toBe('done'); await expect(client.lookupDevelopmentUsage(task)).rejects.toThrow('停止阶段已经完成');
    } finally { f.permit(true); await f.drop(); }
  }, 20_000);
  test('two retained storage keys for one task remain blocked, so no numerical stream can disappear from the canonical directory', async () => {
    const f = await sessionDeletionFixture();
    try {
      const task = f.task(); f.origins.set('418', f.origins.get(task)!);
      for (const key of [task, '418']) await f.database.db.execute(sql`INSERT INTO session.development_usage_streams(task_id,registration) VALUES(${key},'{}'::jsonb)`);
      const context = await f.context(); expect((await f.first.module.api.deletionOwner!.run(context)).kind).toBe('done');
      await expect(createProjectDeletionSessionClient(f.first.address, loopbackRequest).tasks(context)).rejects.toThrow('不能证明排空');
      expect(await f.database.db.execute(sql`SELECT task_id FROM session.development_usage_streams`)).toHaveLength(2);
    } finally { await f.drop(); }
  });
  test('direct private reads cannot report absence when the retained legacy key has an orphan numerical event', async () => {
    const identity = { podUid: crypto.randomUUID(), containerId: 'containerd://' + 'a'.repeat(64), nodeUid: crypto.randomUUID(), nodeName: 'legacy-session-node',
      pid: process.pid, pidNamespace: '173', bootId: crypto.randomUUID(), startTicks: '91' };
    const f = await sessionDeletionFixture({ protectCurrent: async () => identity, sweep: async () => {} });
    try {
      const task = f.task(); f.origins.set('419', f.origins.get(task)!);
      await f.database.db.execute(sql`INSERT INTO session.business_usage_events(task_id,execution_id,sequence,agent_id,occurred_at,capture) VALUES('419','original-orphan',1,'agent',${developmentAt},${JSON.stringify(developmentCapture(1))}::jsonb)`);
      const context = await f.context(); expect((await f.first.module.api.deletionOwner!.run(context)).kind).toBe('done');
      const client = createProjectDeletionSessionClient(f.first.address, loopbackRequest)({ ...context, phase: 'stop' }, task);
      await expect(client.lookupDevelopmentUsage(task)).rejects.toThrow('不能证明排空');
      expect(await f.database.db.execute(sql`SELECT task_id FROM session.business_usage_events WHERE task_id='419'`)).toHaveLength(1);
    } finally { await f.drop(); }
  });
});
