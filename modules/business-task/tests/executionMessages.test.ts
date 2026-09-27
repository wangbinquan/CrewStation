import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { BusinessOperationDto, BusinessSubtaskV3Dto, RunnerBusinessEvent, RunnerBusinessMessageReceipt, TaskId } from '@crewstation/contracts';
import { PlatformError } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionAgentFixture } from './executionAgentFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 durable interactive message outbox', () => {
  let tdb: TestDatabase;
  beforeEach(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterEach(async () => { await tdb?.drop(); });
  async function waitingAgent() {
    const f = await executionAgentFixture(tdb.db), view = await (await f.request(f.path, { ...f.input, mode: 'interactive' })).json() as BusinessSubtaskV3Dto;
    const env = f.ready(); await f.module.api.v3.runOnce();
    const receipt = f.receipts.get(view.executionId)!; receipt.lastSequence = 2;
    const events: RunnerBusinessEvent[] = [
      { sequence: 1, occurredAt: new Date().toISOString(), frame: { type: 'state', state: 'running' } },
      { sequence: 2, occurredAt: new Date().toISOString(), frame: { type: 'agent', event: { agentId: view.executionId, seq: 1, at: new Date().toISOString(), type: 'status', status: 'waiting' } } },
    ];
    f.runner.getBusinessExecution = async (taskId, id) => { expect(taskId).toBe(env.id); expect(id).toBe(view.executionId); return { taskId: env.id, receipt, persistedThrough: 2, acknowledgedThrough: 2, complete: false }; };
    f.runner.listBusinessExecutionEvents = async (_taskId, _id, after = 0) => events.filter((event) => event.sequence > after);
    await f.module.api.v3.runOnce(); expect((await f.get(view.id)).state).toBe('awaiting-input');
    const messages = new Map<string, RunnerBusinessMessageReceipt>(), state = { sends: 0, loseReply: false }, send = f.runner.sendCommand;
    f.runner.sendCommand = async (taskId: TaskId, command) => {
      if (command.type === 'getBusinessMessage') { const previous = messages.get(command.messageId); if (!previous) throw new PlatformError('not_found', 'missing', { code: 'message_not_found' }); return previous; }
      if (command.type !== 'sendBusinessMessage') return send(taskId, command);
      state.sends++; expect(taskId).toBe(env.id);
      const result: RunnerBusinessMessageReceipt = { executionId: command.executionId, messageId: command.messageId, attempt: command.attempt, incarnation: command.incarnation, payloadDigest: command.payloadDigest, phase: 'delivered' };
      messages.set(command.messageId, result); if (state.loseReply) throw new Error('message reply lost'); return result;
    };
    return { ...f, view, messages, state, messagePath: `${f.path}/${view.id}/messages`, message: { requestKey: 'message-one', expectedAttempt: 1, content: 'private followup', fence: f.fence } };
  }
  test('lost reply reconciles original message; duplicates, changed content and stale attempt never write another message', async () => {
    const f = await waitingAgent(); f.state.loseReply = true;
    const response = await f.request(f.messagePath, f.message); expect(response.status).toBe(202);
    const operation = await response.json() as BusinessOperationDto; expect(operation).toMatchObject({ state: 'running', message: 'message_delivery_unknown' });
    const reconstructed = f.make(); await reconstructed.module.api.v3.runOnce();
    expect(await (await reconstructed.request(`/v3/business-tasks/${f.task.id}/operations/${operation.operationId}`)).json()).toMatchObject({ state: 'succeeded' });
    expect((await f.request(f.messagePath, { ...f.message, fence: undefined })).status).toBe(202); expect(f.state.sends).toBe(1);
    expect((await f.request(f.messagePath, { ...f.message, content: 'changed' })).status).toBe(409);
    expect((await f.request(f.messagePath, { ...f.message, requestKey: 'stale', expectedAttempt: 2 })).status).toBe(409);
    const other = await executionAgentFixture(tdb.db); expect((await other.request(`/v3/business-tasks/${f.task.id}/operations/${operation.operationId}`)).status).toBe(404);
  });
});
