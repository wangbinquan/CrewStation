import { describe, expect, test } from 'bun:test';
import type { BusinessSubtaskV3Dto, RunnerBusinessEvent, RunnerBusinessMessageReceipt } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { executionCommandFixture } from '../executionCommandFixture';
import { executionAgentFixture } from '../executionAgentFixture';
import { businessWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('actual business workers retain original callback lifetimes (PG/HTTP; controlled runtime ports)', () => {
  test('command dispatch, cancellation and pause retain independent original consumer identities', async () => {
    const f = await businessWorkFixture();
    try {
      const business = await executionCommandFixture(f.database.db); f.bind(business.serviceId, business.projectId);
      business.environmentPort.pauseEnvironment = async () => { business.env.state = 'paused'; return business.env; };
      business.environmentPort.resumeEnvironment = async () => { business.env.state = 'running'; business.env.connected = true; return business.env; };
      const mounted = business.make({ deletionWorkSources: f.sources });
      const paused = await mounted.request('/v3/business-tasks/' + business.task.id + '/pause', { requestKey: 'pause-original', expectedGeneration: 1, fence: business.fence });
      expect(paused.status).toBe(202); expect(await paused.json()).toMatchObject({ state: 'succeeded' });
      const resumed = await mounted.request('/v3/business-tasks/' + business.task.id + '/resume', { requestKey: 'resume-original', expectedGeneration: 2, fence: business.fence });
      expect(resumed.status).toBe(202); expect(await resumed.json()).toMatchObject({ state: 'succeeded' });
      const response = await mounted.request(business.path, business.input); expect(response.status).toBe(201);
      const child = await response.json() as BusinessSubtaskV3Dto;
      const cancelled = await mounted.request(business.path + '/' + child.id + '/cancel', { requestKey: 'cancel-original', expectedAttempt: 1, fence: business.fence });
      expect(cancelled.status).toBe(202);
      const history = await mounted.module.projectWork!.history(business.projectId);
      expect(history.filter((row) => row.kind !== 'service-api').map((row) => row.kind).sort()).toEqual(['cancellation', 'lifecycle', 'lifecycle', 'subtask']);
      expect(history.filter((row) => row.kind === 'service-api')).toHaveLength(4);
      expect(history.every((row) => row.exited && row.serviceId === business.serviceId && row.projectId === business.projectId)).toBe(true);
      expect(new Set(history.map((row) => row.consumerId)).size).toBe(8); expect(business.behavior.starts).toBe(1);
    } finally { await f.drop(); }
  });

  test('actual result projection and source consumption each finish their original awaited callback', async () => {
    const f = await businessWorkFixture();
    try {
      const business = await executionCommandFixture(f.database.db); f.bind(business.serviceId, business.projectId);
      const mounted = business.make({ deletionWorkSources: f.sources });
      const child = await (await mounted.request(business.path, business.input)).json() as BusinessSubtaskV3Dto;
      const receipt = business.receipts.get(child.executionId)!;
      const result = { exitCode: 0, reason: 'exited' as const, durationMs: 100 };
      const events: RunnerBusinessEvent[] = [{ sequence: 1, occurredAt: new Date().toISOString(), frame: { type: 'state', state: 'running' } },
        { sequence: 2, occurredAt: new Date().toISOString(), frame: { type: 'result', result } }];
      business.runner.getBusinessExecution = async () => ({ taskId: business.task.id, receipt: { ...receipt, phase: 'finished', result, lastSequence: 2 }, persistedThrough: 2, acknowledgedThrough: 2, complete: true });
      business.runner.listBusinessExecutionEvents = async (_task, _execution, after = 0) => events.filter((event) => event.sequence > after);
      const acknowledgements: string[] = []; business.runner.consumeBusinessExecution = async (_task, execution) => { acknowledgements.push(execution); };
      await mounted.module.api.v3.runOnce();
      const projected = await (await mounted.request(business.path + '/' + child.id)).json() as BusinessSubtaskV3Dto;
      expect(projected.state).toBe('succeeded'); expect(acknowledgements).toEqual([child.executionId]);
      const history = await mounted.module.projectWork!.history(business.projectId);
      expect(history.filter((row) => row.kind !== 'service-api').map((row) => row.kind).sort()).toEqual(['projection', 'projection', 'subtask']);
      expect(history.filter((row) => row.kind === 'service-api')).toHaveLength(1); expect(history.every((row) => row.exited)).toBe(true);
      await mounted.module.api.v3.runOnce(); expect(acknowledgements).toEqual([child.executionId]);
    } finally { await f.drop(); }
  });

  test('a late source snapshot after backend loss cannot start another event request or acknowledge consumption', async () => {
    const f = await businessWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let running: Promise<unknown> | undefined;
    try {
      const business = await executionCommandFixture(f.database.db); f.bind(business.serviceId, business.projectId);
      const sources = { ...f.sources, assertGrant: async () => undefined }, mounted = business.make({ deletionWorkSources: sources });
      const child = await (await mounted.request(business.path, business.input)).json() as BusinessSubtaskV3Dto;
      const receipt = business.receipts.get(child.executionId)!; let lists = 0, acknowledgements = 0;
      business.runner.getBusinessExecution = async () => { entered.resolve(); await release.promise; return { taskId: business.task.id, receipt, persistedThrough: 1, acknowledgedThrough: 1, complete: false }; };
      business.runner.listBusinessExecutionEvents = async () => { lists++; return []; };
      business.runner.consumeBusinessExecution = async () => { acknowledgements++; };
      running = mounted.module.api.v3.runOnce(); await entered.promise;
      const birth = (await mounted.module.projectWork!.history(business.projectId)).find((row) => row.kind === 'projection' && !row.exited)!;
      await f.database.db.execute(sql`SELECT pg_terminate_backend(${birth.backendPid})`); await running;
      const context = f.context();
      expect(await mounted.module.projectWork!.seal({ ...context, target: { ...context.target, id: business.projectId, serviceId: business.serviceId } })).toEqual({ pending: [birth.id] });
      release.resolve(); await f.waitExit(birth.id);
      expect(lists).toBe(0); expect(acknowledgements).toBe(0);
      expect((await mounted.module.projectWork!.history(business.projectId)).find((row) => row.id === birth.id)?.exited).toBe(true);
    } finally { release.resolve(); await running?.catch(() => undefined); await f.drop(); }
  });

  test('interactive messages and original Agent cleanup are included in actual worker lifetimes', async () => {
    const f = await businessWorkFixture();
    try {
      const business = await executionAgentFixture(f.database.db); f.bind(business.serviceId, business.projectId);
      const mounted = business.make({ deletionWorkSources: f.sources });
      const child = await (await mounted.request(business.path, { ...business.input, mode: 'interactive' })).json() as BusinessSubtaskV3Dto;
      business.ready(); await mounted.module.api.v3.runOnce();
      const receipt = business.receipts.get(child.executionId)!; receipt.lastSequence = 2;
      const events: RunnerBusinessEvent[] = [{ sequence: 1, occurredAt: new Date().toISOString(), frame: { type: 'state', state: 'running' } },
        { sequence: 2, occurredAt: new Date().toISOString(), frame: { type: 'agent', event: { agentId: child.executionId, seq: 1, at: new Date().toISOString(), type: 'status', status: 'waiting' } } }];
      business.runner.getBusinessExecution = async () => ({ taskId: business.creates[0]!.id, receipt, persistedThrough: 2, acknowledgedThrough: 2, complete: false });
      business.runner.listBusinessExecutionEvents = async (_task, _execution, after = 0) => events.filter((event) => event.sequence > after);
      await mounted.module.api.v3.runOnce();
      const send = business.runner.sendCommand;
      business.runner.sendCommand = async (task, command) => {
        if (command.type !== 'sendBusinessMessage') return send(task, command);
        const result: RunnerBusinessMessageReceipt = { executionId: command.executionId, messageId: command.messageId, attempt: command.attempt, incarnation: command.incarnation, payloadDigest: command.payloadDigest, phase: 'delivered' };
        return result;
      };
      const message = await mounted.request(business.path + '/' + child.id + '/messages', { requestKey: 'message-original', expectedAttempt: 1, content: 'private message', fence: business.fence });
      expect(message.status).toBe(202); expect(await message.json()).toMatchObject({ state: 'succeeded' });
      await f.database.db.execute(sql`UPDATE business_task.execution_subtasks SET dispatch='failed',view=jsonb_set(jsonb_set(view,'{state}','"failed"'),'{process}','"exited"') WHERE id=${child.id}`);
      await mounted.module.api.v3.runOnce();
      const history = await mounted.module.projectWork!.history(business.projectId);
      for (const kind of ['subtask', 'message', 'projection', 'agent-cleanup']) expect(history.some((row) => row.kind === kind && row.exited)).toBe(true);
      expect(business.environments.get(business.creates[0]!.id)?.state).toBe('releasing');
    } finally { await f.drop(); }
  });

  test('a contradictory original accepted task cannot create a callback or dispatch a command', async () => {
    const f = await businessWorkFixture();
    try {
      const business = await executionCommandFixture(f.database.db); f.bind(business.serviceId, business.projectId);
      await f.database.db.execute(sql`UPDATE business_task.execution_operations SET intent=jsonb_set(intent,'{task,serviceId}',to_jsonb(${f.otherService}::text)) WHERE intent->'task'->>'id'=${business.task.id}`);
      const mounted = business.make({ deletionWorkSources: f.sources });
      const response = await mounted.request(business.path, business.input); expect(response.status).toBe(412);
      expect(await response.json()).toMatchObject({ message: '业务执行回调缺少同一原项目／服务的受理任务根' });
      expect(business.behavior.starts).toBe(0);
      const history = await mounted.module.projectWork!.history(business.projectId);
      expect(history).toHaveLength(1); expect(history[0]).toMatchObject({ kind: 'service-api', exited: true, reference: business.serviceId });
      await expect(mounted.module.projectWork!.effect(async () => undefined)).rejects.toThrow('缺少原受理回调');
    } finally { await f.drop(); }
  });
});
