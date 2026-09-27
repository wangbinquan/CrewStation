import { prepareBusinessCommand, persistBusinessReply } from '../application/businessCommandReceipt';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { RunnerBusinessEvent, RunnerBusinessReceipt, RunnerCommand, TaskId } from '@crewstation/contracts';
import { TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import { fixedClock } from '@crewstation/kernel';
import { createApp } from '@crewstation/http';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleBusinessExecutionStore } from '../adapters/persistence/businessExecutions';
import { ingestBusinessExecution } from '../application/businessIngestion';
import { commandDispatch } from '../application/commandDispatch';
import { RunnerConnection } from '../domain/runnerConnection';
import { createSessionModule, sessionMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const taskId = '01a0bf5d-8f4b-7001-8458-107366e7de39' as TaskId, incarnation = crypto.randomUUID();
const receipt: RunnerBusinessReceipt = { executionId: 'ingest', attempt: 1, incarnation, payloadDigest: 'a'.repeat(64), phase: 'finished',
  lastSequence: 3, acknowledgedSequence: 0, outputBytes: 4, result: { reason: 'exited', exitCode: 0, durationMs: 100 } };
const events: RunnerBusinessEvent[] = [
  { sequence: 1, occurredAt: '2026-09-27T09:00:00.000Z', frame: { type: 'state', state: 'running' } },
  { sequence: 2, occurredAt: '2026-09-27T09:00:00.001Z', frame: { type: 'output', stream: 'stdout', text: 'tail' } },
  { sequence: 3, occurredAt: '2026-09-27T09:00:00.002Z', frame: { type: 'result', result: receipt.result! } },
];

describe.skipIf(!available)('session 可靠事件接收与派发', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([sessionMigrations]); });
  afterAll(async () => { await tdb.drop(); });

  test('PG 提交后才 ACK，确认回执丢失后重建接收器不会重读已回收输出', async () => {
    const store = drizzleBusinessExecutionStore(tdb.db);
    const initial = await store.register(taskId, { ...receipt, phase: 'registered', lastSequence: 0, result: null, outputBytes: 0 });
    let deleted = false, loseAck = true;
    const sent: string[] = [];
    const send = async (_taskId: TaskId, command: RunnerCommand) => {
      sent.push(command.type);
      if (command.type === 'getBusinessExecution') return { ...receipt, acknowledgedSequence: deleted ? 3 : 0 };
      if (command.type === 'readBusinessExecutionEvents') { expect(deleted).toBe(false); return events; }
      if (command.type === 'ackBusinessExecutionEvents') {
        expect(await store.get(taskId, receipt.executionId)).toMatchObject({ complete: true, persistedThrough: 3 });
        expect(command.through).toBe(3); deleted = true;
        if (loseAck) { loseAck = false; throw new Error('ack receipt lost'); }
        return {};
      }
      throw new Error('unexpected command');
    };
    await expect(ingestBusinessExecution({ store, send }, initial)).rejects.toThrow('ack receipt lost');
    expect(await store.get(taskId, receipt.executionId)).toMatchObject({ complete: true, acknowledgedThrough: 0 });
    const restarted = drizzleBusinessExecutionStore(tdb.db);
    await ingestBusinessExecution({ store: restarted, send }, (await restarted.get(taskId, receipt.executionId))!);
    expect(await restarted.get(taskId, receipt.executionId)).toMatchObject({ complete: true, acknowledgedThrough: 3 });
    expect(sent.filter((type) => type === 'readBusinessExecutionEvents')).toHaveLength(1);
    expect(await restarted.list(taskId, receipt.executionId, 0, 200)).toEqual(events);
  });

  test('PG 登记先于 socket；未持久化输出的 ACK 不写 socket，迟到启动回执仍可由后台补读', async () => {
    const store = drizzleBusinessExecutionStore(tdb.db), sent: RunnerCommand[] = [];
    const started = { ...receipt, executionId: 'start-before-wire', phase: 'running' as const, lastSequence: 1, outputBytes: 0, result: null };
    const connection: RunnerConnection = new RunnerConnection({ type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId, runnerToken: 't', workdir: '/work',
      capabilities: { protocols: [], pty: false, preview: false, businessExecutionV3: 1 } }, { send: (raw) => {
      const command = JSON.parse(raw) as RunnerCommand; sent.push(command);
      void store.get(taskId, started.executionId).then((saved) => {
        expect(saved?.receipt.phase).toBe('registered');
        connection.pending.settle(command.id, { ok: true, payload: started });
      });
    } }, 0, 1000, 0);
    const dispatch = commandDispatch({ businessExecutions: store, registry: { lookup: async () => undefined, claim: async () => {}, release: async () => {}, heartbeat: async () => {} },
      forwarder: { forward: async () => { throw new Error('unexpected forward'); } }, clock: fixedClock('2026-09-27T09:00:00Z'), settings: { selfAddress: 'local', commandTimeoutMs: 1000, runnerStaleMs: 60000, replayLimit: 100 } }, { connections: new Map([[taskId, connection]]) });
    const command: RunnerCommand = { id: 'start', type: 'startBusinessCommand', executionId: started.executionId, incarnation, attempt: 1, payloadDigest: receipt.payloadDigest, command: ['true'], env: {}, timeoutSeconds: 10 };
    expect(await dispatch.sendCommand(taskId, command)).toEqual(started);
    expect((await store.get(taskId, started.executionId))?.receipt.phase).toBe('running');
    await expect(dispatch.sendCommand(taskId, { id: 'bad-ack', type: 'ackBusinessExecutionEvents', executionId: started.executionId, through: 1 })).rejects.toMatchObject({ kind: 'precondition' });
    expect(sent).toHaveLength(1);
    const cancelId = 'cancel-through-dispatch', cancelled = { ...receipt, executionId: cancelId, lastSequence: 1, outputBytes: 0, result: { reason: 'cancelled' as const, exitCode: null, durationMs: 0 } };
    connection.socket.send = (raw) => {
      const sent = JSON.parse(raw) as RunnerCommand;
      void store.get(taskId, cancelId).then((saved) => {
        expect(saved?.receipt.phase).toBe('registered');
        connection.pending.settle(sent.id, { ok: true, payload: cancelled });
      });
    };
    expect(await dispatch.sendCommand(taskId, { id: 'cancel-through-wire', type: 'cancelBusinessExecution', executionId: cancelId, registration: { attempt: 1, incarnation, payloadDigest: receipt.payloadDigest } })).toEqual(cancelled);
    expect(await store.get(taskId, cancelId)).toMatchObject({ receipt: { phase: 'finished' }, complete: false });
    expect((await store.pending([taskId], 100)).some((row) => row.receipt.executionId === started.executionId)).toBe(true);
  });

  test('取消可以先登记可靠执行，早于 start 的墓碑仍被后台接收', async () => {
    const store = drizzleBusinessExecutionStore(tdb.db), executionId = 'cancel-before-start';
    const command: RunnerCommand = { id: 'cancel-first', type: 'cancelBusinessExecution', executionId, registration: { attempt: 1, incarnation, payloadDigest: receipt.payloadDigest } };
    await prepareBusinessCommand(store, taskId, command);
    expect(await store.get(taskId, executionId)).toMatchObject({ receipt: { phase: 'registered' } });
    const cancelled: RunnerBusinessReceipt = { ...receipt, executionId, lastSequence: 1, outputBytes: 0, result: { reason: 'cancelled', exitCode: null, durationMs: 0 } };
    await persistBusinessReply(store, taskId, command, cancelled);
    expect(await store.get(taskId, executionId)).toMatchObject({ receipt: { phase: 'finished' }, complete: false });
    expect(await store.ingest(taskId, cancelled, [{ sequence: 1, occurredAt: new Date().toISOString(), frame: { type: 'result', result: cancelled.result! } }])).toMatchObject({ complete: true });
  });

  test('Runner 离线时内部 HTTP 仍能读取持久快照和连续事件，跨任务及坏游标明确拒绝', async () => {
    const store = drizzleBusinessExecutionStore(tdb.db), storedReceipt = { ...receipt, executionId: 'http-read' };
    await store.register(taskId, storedReceipt); await store.ingest(taskId, storedReceipt, events);
    const module = createSessionModule({ db: tdb.db, runnerAuth: { verifyRunnerToken: async () => ({ ok: false, reason: 'offline' }) },
      taskAccess: { canOpenStream: async () => false, onRunnerConnected: async () => {}, onRunnerDisconnected: async () => {} }, isAdmin: async () => false,
      settings: { selfAddress: 'local', commandTimeoutMs: 1000, runnerStaleMs: 60000, replayLimit: 100 } });
    const app = createApp({ name: 'business-session-read' }); app.route('/', module.http.internal);
    const base = `/internal/tasks/${taskId}/executions/http-read`;
    const snapshot = await app.request(base);
    expect(snapshot.status).toBe(200); expect(await snapshot.json()).toMatchObject({ complete: true, persistedThrough: 3 });
    expect((await app.request(`${base}/events?after=1&limit=1`)).status).toBe(200);
    expect(await (await app.request(`${base}/events?after=1&limit=1`)).json()).toEqual({ items: [events[1]] });
    expect((await app.request(`${base}/events?after=10`)).status).toBe(400);
    expect((await app.request(`${base}/events?extra=ignored`)).status).toBe(400);
    expect((await app.request(base.replace(taskId, '01a0bf5d-8f4b-7001-8458-107366e7de42'))).status).toBe(404);
    expect(await module.api.getBusinessExecution(taskId, storedReceipt.executionId)).toMatchObject({ complete: true });
    expect(await module.api.listBusinessExecutionEvents(taskId, storedReceipt.executionId, 0, 100)).toEqual(events);
    expect(await module.api.connectionStatus(taskId)).toEqual({ connected: false });
  });
});
