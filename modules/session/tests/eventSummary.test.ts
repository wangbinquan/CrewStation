import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { RunnerEvent, TaskId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleRunnerEventStore } from '../adapters/persistence/drizzleRepositories';
import type { SessionModule } from '../wiring';
import { createSessionModule, sessionMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase, session: SessionModule;
const headless = newResourceId() as TaskId, cli = newResourceId() as TaskId, quiet = newResourceId() as TaskId, silent = newResourceId() as TaskId;
const at = '2026-09-23T10:00:00.000Z';
const agent = (type: string, extra: Record<string, unknown> = {}): RunnerEvent => ({ kind: 'agent', event: { agentId: 'agent-1', seq: 0, at, type, ...extra } as never });

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([sessionMigrations]);
  session = createSessionModule({
    db: tdb.db, isAdmin: async () => false,
    runnerAuth: { verifyRunnerToken: async () => ({ ok: false, reason: 'unused' }) },
    taskAccess: { canOpenStream: async () => false, onRunnerConnected: async () => undefined, onRunnerDisconnected: async () => undefined },
    settings: { selfAddress: 'http://127.0.0.1:0', commandTimeoutMs: 2000, runnerStaleMs: 30000, replayLimit: 100 },
  });
  const store = drizzleRunnerEventStore(tdb.db);
  const append = async (taskId: TaskId, events: RunnerEvent[]) => { for (const [i, event] of events.entries()) await store.append({ taskId, seq: i + 1, at: new Date(at), event }); };
  await append(headless, [
    agent('started', { spec: { compute: 'c', profileRevision: 1, protocol: 'opencode', permission: 'full' } }),
    agent('session', { sessionId: 'ses_b' }), agent('text', { text: 'hi', sessionId: 'ses_b' }), agent('completed', { sessionId: 'ses_a' }),
    // 平台自己执行的命令结束事件：不算条数，也不带会话。
    { kind: 'execExited', execId: 'git-1', exitCode: 0, durationMs: 3 },
  ]);
  await append(cli, [
    { kind: 'nativeTerminal', terminal: { agentId: 'agent-2', terminalId: 't', runnerId: newResourceId(), compute: 'c', permission: 'full', revision: 1, lifecycle: 'running', startedAt: at, protocol: 'claude-code', nativeSessionId: 'native-1', cols: 80, rows: 24 } } as RunnerEvent,
    { kind: 'terminalClosed', terminalId: 't', exitCode: 0 },
  ]);
  await append(quiet, [{ kind: 'execExited', execId: 'git-2', exitCode: 0, durationMs: 1 }]);
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('事件汇总（调用链回放用）', () => {
  test('按任务数指定种类的事件，收集去重后的原生会话 ID 与协议；只有平台命令或没有事件的任务不返回', async () => {
    const summary = await session.api.summarizeEvents([headless, cli, quiet, silent], ['agent', 'terminalClosed']);
    const byTask = new Map(summary.map((s) => [s.taskId, s]));
    expect(byTask.get(headless)).toEqual({ taskId: headless, events: 4, sessionIds: ['ses_a', 'ses_b'], protocol: 'opencode' });
    // CLI 的名册事件只提供会话 ID 与协议，不在指定种类里就不计数。
    expect(byTask.get(cli)).toEqual({ taskId: cli, events: 1, sessionIds: ['native-1'], protocol: 'claude-code' });
    expect(byTask.has(quiet)).toBe(false);
    expect(byTask.has(silent)).toBe(false);
    expect(await session.api.summarizeEvents([], ['agent'])).toEqual([]);
  });
});
