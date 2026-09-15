import { describe, expect, test } from 'bun:test';
import type { NativeTerminalDto, RunnerEvent, TaskId } from '@crewstation/contracts';
import { AgentActivityPageSchema } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { runMigrations } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { drizzleNativeTerminals } from '../adapters/persistence/drizzleNativeTerminals';
import { drizzleNativeActivity } from '../adapters/persistence/drizzleNativeActivity';
import { nativeActivityUseCases } from '../application/nativeActivity';
import type { StoredNativeEvent } from '../ports/nativeActivity';
import { devSessionMigrations } from '../wiring';
import { isolatedNativeFixture } from './isolatedNativeFixture';
import { workspaceActor as actor, workspaceTask as taskId } from './workspaceFixture';

const available = await testDatabaseAvailable();
const eventsFor = (terminal: NativeTerminalDto, end: 'turn-completed' | 'request-opened'): StoredNativeEvent[] => ['source-ready', 'turn-started', end].map((kind, index) => ({
  seq: index + 1, at: terminal.startedAt, event: { kind: 'nativeActivity', activity: {
    agentId: terminal.agentId, terminalId: terminal.terminalId, runnerId: terminal.runnerId, seq: index + 1, eventId: `same-${index}`, turnOrdinal: index ? 1 : 0,
    signal: { kind, source: 'opencode/1.18.29', sourceEventId: `native-${index}`, occurredAt: terminal.startedAt, nativeSessionId: index ? 'session' : null, turnId: index ? 'turn-1' : null,
      ...(kind === 'request-opened' ? { request: { id: 'question', kind: 'question' } } : {}) },
  } } as RunnerEvent,
}));

describe.skipIf(!available)('多个独立 CLI 动态的真实数据库汇聚', () => {
  test('相同 seq 和 eventId 不覆盖，父断线不掩盖子完成和等待；去重、个人已读、最终来源封存', async () => {
    const database = await createTestDatabase([devSessionMigrations]);
    try {
      const f = isolatedNativeFixture(), one = await f.start(), two = await f.start();
      const terminals = drizzleNativeTerminals(database.db), repo = drizzleNativeActivity(database.db);
      for (const terminal of [one, two]) await terminals.reserve((await f.repository.findAgent(taskId, terminal.agentId))!);
      const sources = new Map<TaskId, StoredNativeEvent[]>([[one.execution!.taskId, eventsFor(one, 'turn-completed')], [two.execution!.taskId, eventsFor(two, 'request-opened')]]);
      const sourceCalls: TaskId[] = [];
      f.deps.runner.listEvents = async (source, query) => { sourceCalls.push(source); return sources.get(source)?.filter((r) => r.seq > (query?.sinceSeq ?? 0)) ?? []; };
      f.state.connected = false;
      const api = nativeActivityUseCases(f.deps, repo, terminals), second = nativeActivityUseCases(f.deps, drizzleNativeActivity(database.db), terminals);
      await Promise.all([api.getAgentActivity(actor, taskId, { limit: 20 }), second.getAgentActivity(actor, taskId, { limit: 20 })]);
      let page = AgentActivityPageSchema.parse(await api.getAgentActivity(actor, taskId, { limit: 20 }));
      expect(page.connection).toBe('disconnected'); expect(page.items).toHaveLength(6);
      expect(new Set(page.items.map((item) => item.seq)).size).toBe(6); expect(new Set(page.items.map((item) => item.eventId)).size).toBe(6);
      expect(page.states.find((s) => s.agentId === one.agentId)).toMatchObject({ connection: 'connected', sync: 'ready', currentTurn: { status: 'completed' }, processEnded: false });
      expect(page.states.find((s) => s.agentId === two.agentId)).toMatchObject({ connection: 'connected', sync: 'ready', pending: [{ id: 'question', unread: true }] });
      expect(await repo.cursor(taskId, one.execution!.taskId)).toBe(3); expect(await repo.cursor(taskId, two.execution!.taskId)).toBe(3);
      await api.readAgentActivity(actor, taskId, { agentId: one.agentId, turnId: 'turn-1', throughSeq: page.throughSeq });
      expect((await api.getAgentActivity(actor, taskId, { limit: 20 })).unread).toEqual([]);
      // 把另一 Runner 的事件放入父来源不会伪造新状态。
      sources.set(taskId, [{ ...eventsFor(two, 'turn-completed')[2]!, seq: 100 }]);
      page = await api.getAgentActivity(actor, taskId, { limit: 20 });
      expect(page.states.find((s) => s.agentId === two.agentId)?.currentTurn?.status).toBe('waiting');
      f.controls.offline.add(two.execution!.taskId);
      expect((await api.getAgentActivity(actor, taskId, { limit: 20 })).states.find((s) => s.agentId === one.agentId)?.connection).toBe('connected');
      await terminals.saveRecord(taskId, { ...(await terminals.findAgent(taskId, one.agentId))!.record, lifecycle: 'ended', revision: 20 });
      await terminals.saveSnapshot(taskId, one.agentId, { status: 'unavailable' }); await terminals.finalize(taskId, one.agentId);
      await api.getAgentActivity(actor, taskId, { limit: 20 });
      const calls = sourceCalls.filter((id) => id === one.execution!.taskId).length;
      page = await api.getAgentActivity(actor, taskId, { limit: 20 });
      expect(sourceCalls.filter((id) => id === one.execution!.taskId)).toHaveLength(calls);
      expect(page.states.find((s) => s.agentId === one.agentId)).toMatchObject({ processEnded: true, pending: [], currentTurn: { status: 'completed' } });
    } finally { await database.drop(); }
  });

  test('升级把既有父事件游标带到来源表，继续同步不重播或跳过旧历史', async () => {
    const database = await createTestDatabase([{ ...devSessionMigrations, files: devSessionMigrations.files.filter((file) => !file.name.startsWith('0006_')) }]);
    try {
      await database.db.execute(sql`insert into dev_session.native_activity_progress (task_id, through_seq, pruned_through_seq) values (${taskId}, 55, 20)`);
      expect(await runMigrations(database.db, [devSessionMigrations])).toEqual(['dev_session/0006_native_executions.sql']);
      const repo = drizzleNativeActivity(database.db);
      expect(await repo.cursor(taskId)).toBe(55);
      await repo.apply(taskId, 55, [{ seq: 60, at: '2026-09-13T00:00:00.000Z', event: { kind: 'previewState', state: 'stopped' } }]);
      expect(await repo.cursor(taskId)).toBe(60);
      expect(await repo.read(taskId, actor.userId, { limit: 10 })).toMatchObject({ throughSeq: 60, historyTruncated: true, items: [] });
      expect(await runMigrations(database.db, [devSessionMigrations])).toEqual([]);
    } finally { await database.drop(); }
  });
});
