import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { NativeActivitySignal, NativeTerminalRecord } from '@crewstation/contracts';
import { AgentActivityStateSchema, TaskIdSchema, UserIdSchema } from '@crewstation/contracts';
import { newId } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleNativeActivity } from '../adapters/persistence/drizzleNativeActivity';
import { drizzleNativeTerminals } from '../adapters/persistence/drizzleNativeTerminals';
import type { StoredNativeEvent } from '../ports/nativeActivity';
import { devSessionMigrations } from '../wiring';
import { workspaceActor } from './workspaceFixture';

const available = await testDatabaseAvailable();
let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([devSessionMigrations]); });
afterAll(async () => { await database?.drop(); });

async function fixture() {
  const taskId = TaskIdSchema.parse(newId('tsk')), agentId = newId('agt');
  const record: NativeTerminalRecord = { agentId, terminalId: newId('pty'), runnerId: crypto.randomUUID(), compute: 'balanced', permission: 'edit', revision: 1, lifecycle: 'running', startedAt: new Date().toISOString(), cols: 80, rows: 24 };
  await drizzleNativeTerminals(database.db).reserve({ taskId, createdBy: workspaceActor.userId, clientRequestId: crypto.randomUUID(), fingerprint: 'activity', driver: 'claude-code', model: 'anthropic/model', input: { clientRequestId: crypto.randomUUID(), permission: 'edit', cols: 80, rows: 24 }, record });
  let seq = 0;
  const event = (kind: NativeActivitySignal['kind'], ordinal = 0, fields: Partial<NativeActivitySignal> = {}): StoredNativeEvent => {
    const current = ++seq;
    return { seq: current * 10, at: record.startedAt, event: { kind: 'nativeActivity', activity: {
      agentId, terminalId: record.terminalId, runnerId: record.runnerId, seq: current, eventId: crypto.randomUUID(), turnOrdinal: ordinal,
      signal: { kind, source: 'claude-code/2.1.268', sourceEventId: crypto.randomUUID(), occurredAt: record.startedAt, nativeSessionId: ordinal ? 'session' : null, turnId: ordinal ? `turn-${ordinal}` : null, ...fields },
    } } };
  };
  return { taskId, agentId, record, event, repo: drizzleNativeActivity(database.db), user: workspaceActor.userId, other: UserIdSchema.parse(newId('usr')) };
}

describe.skipIf(!available)('原生动态投影和个人已读的真实数据库', () => {
  test('跨实例同批去重，查看只清本人未读，不解决正在等待的原生请求', async () => {
    const f = await fixture(), second = drizzleNativeActivity(database.db);
    const events = [f.event('source-ready'), f.event('turn-started', 1), f.event('request-opened', 1, { request: { id: 'q', kind: 'question' } })];
    await Promise.all([f.repo.apply(f.taskId, 0, events), second.apply(f.taskId, 0, events)]);
    const first = await f.repo.read(f.taskId, f.user, { limit: 50 });
    expect(first.items).toHaveLength(3); expect(first.states[0]?.pending).toHaveLength(1); expect(first.items.at(-1)?.unread).toBe(true);
    const through = await f.repo.markRead(f.taskId, f.user, { agentId: f.agentId, turnId: 'turn-1', throughSeq: 30 });
    expect(through).toBe(30);
    expect((await second.read(f.taskId, f.user, { limit: 50 })).items.at(-1)?.unread).toBe(false);
    expect((await second.read(f.taskId, f.user, { limit: 50 })).states[0]?.pending).toHaveLength(1);
    expect((await second.read(f.taskId, f.other, { limit: 50 })).items.at(-1)?.unread).toBe(true);
    await f.repo.markRead(f.taskId, f.user, { agentId: f.agentId, turnId: 'turn-1', throughSeq: 20 });
    expect((await second.read(f.taskId, f.user, { limit: 50 })).items.at(-1)?.unread).toBe(false);
    await expect(f.repo.markRead(f.taskId, f.user, { agentId: f.agentId, turnId: 'turn-1', throughSeq: 31 })).rejects.toThrow('已经读取');
    await expect(f.repo.markRead(f.taskId, f.user, { agentId: 'other-agent', turnId: 'turn-1', throughSeq: 30 })).rejects.toThrow('没有可标记');
  });

  test('解决后继续运行，未确认被补齐后只计一个最新结果；结果、JSON 与 cursor 跨实例恢复', async () => {
    const f = await fixture();
    await f.repo.apply(f.taskId, 0, [f.event('source-ready'), f.event('turn-started', 1), f.event('request-opened', 1, { request: { id: 'q', kind: 'permission' } }), f.event('request-resolved', 1, { request: { id: 'q', kind: 'permission', resolution: 'answered' } }), f.event('turn-unconfirmed', 1), f.event('turn-completed', 1), f.event('turn-started', 2)]);
    const page = await drizzleNativeActivity(database.db).read(f.taskId, f.user, { cursor: 0, limit: 3 });
    expect(page).toMatchObject({ nextCursor: 30, hasMore: true, throughSeq: 70, historyTruncated: false });
    expect(page.states[0]?.currentTurn).toMatchObject({ turnId: 'turn-2', status: 'running' }); expect(page.states[0]?.pending).toEqual([]);
    expect(page.items.find((item) => item.kind === 'request-opened')?.unread).toBe(false);
    expect(page.unread).toEqual([{ agentId: f.agentId, completions: 1, issues: 0 }]);
    const next = await f.repo.read(f.taskId, f.user, { cursor: page.nextCursor, limit: 3 });
    expect(next.items.map((item) => item.seq)).toEqual([40, 50, 60]);
    expect(next.items.find((item) => item.kind === 'turn-unconfirmed')?.unread).toBe(false);
    expect(next.items[0]?.request?.resolvedByEventId).toBe(next.items[0]?.eventId);
    await f.repo.markRead(f.taskId, f.user, { agentId: f.agentId, turnId: 'turn-1', throughSeq: 60 });
    expect((await f.repo.read(f.taskId, f.user, { limit: 50 })).unread).toEqual([]);
    expect((await f.repo.read(f.taskId, f.other, { limit: 50 })).unread[0]?.completions).toBe(1);
    const types = await database.db.execute(sql`select jsonb_typeof(projection) as kind from dev_session.native_activity_states where task_id = ${f.taskId}`);
    expect(types[0]?.kind).toBe('object'); AgentActivityStateSchema.parse(page.states[0]);
  });

  test('名册已写退出也不跳过历史结果；来源缺口／其他 Runner 不伪造完成', async () => {
    const f = await fixture(); await drizzleNativeTerminals(database.db).saveRecord(f.taskId, { ...f.record, lifecycle: 'ended', revision: 3 });
    await f.repo.apply(f.taskId, 0, [f.event('source-ready'), f.event('turn-started', 1), f.event('turn-completed', 1), f.event('turn-unconfirmed', 1), f.event('process-ended')]);
    const page = await f.repo.read(f.taskId, f.user, { limit: 50 });
    expect(page.states[0]?.processEnded).toBe(true); expect(page.unread[0]?.completions).toBe(1);
    expect(page.items.some((item) => item.kind === 'turn-unconfirmed')).toBe(false);
    const g = await fixture(); const ready = g.event('source-ready'), started = g.event('turn-started', 1); g.event('request-opened', 1);
    await g.repo.apply(g.taskId, 0, [ready, started, g.event('turn-completed', 1)]);
    const unknown = await g.repo.read(g.taskId, g.user, { limit: 50 });
    expect(unknown.states[0]?.sourceReason).toBe('channel-gap'); expect(unknown.unread).toEqual([]);
    const foreign = g.event('turn-completed', 1);
    if (foreign.event.kind === 'nativeActivity') foreign.event.activity.runnerId = crypto.randomUUID();
    await g.repo.apply(g.taskId, 40, [foreign]);
    expect((await g.repo.read(g.taskId, g.user, { limit: 50 })).states[0]?.throughSeq).toBe(40);
    await expect(g.repo.apply(g.taskId, 1000, [])).rejects.toThrow('不能越过');
  });

  test('最近一页与按游标补齐有界，保留上限明确报告截断，普通序号间隔不冒充丢历史', async () => {
    const f = await fixture(); const events = [f.event('source-ready')];
    for (let turn = 1; turn <= 1002; turn++) events.push(f.event('turn-started', turn), f.event('turn-completed', turn));
    let cursor = 0;
    for (let offset = 0; offset < events.length; offset += 500) cursor = await f.repo.apply(f.taskId, cursor, events.slice(offset, offset + 500));
    const page = await f.repo.read(f.taskId, f.user, { limit: 10 });
    expect(page.items).toHaveLength(10); expect(page.items.at(-1)?.seq).toBe(cursor); expect(page.nextCursor).toBe(cursor);
    expect(page.historyTruncated).toBe(true); expect(page.hasMore).toBe(false);
    const catchup = await f.repo.read(f.taskId, f.user, { cursor: 0, limit: 10 });
    expect(catchup.items[0]?.seq).toBe(60); expect(catchup.hasMore).toBe(true); expect(catchup.historyTruncated).toBe(true);
    const count = await database.db.execute(sql`select count(*)::integer as n from dev_session.native_activity_items where task_id = ${f.taskId}`);
    expect(count[0]?.n).toBe(2000);
    await expect(f.repo.read(f.taskId, f.user, { cursor: cursor + 1, limit: 10 })).rejects.toThrow('游标超过');
  }, 15000);

  test('活跃问题早于历史保留边界仍可个人已读，后续清理不清掉该已读位置', async () => {
    const f = await fixture();
    const events = [f.event('source-ready'), f.event('turn-started', 1), f.event('request-opened', 1, { request: { id: 'old-question', kind: 'question' } })];
    for (let turn = 2; turn <= 1003; turn++) events.push(f.event('turn-started', turn), f.event('turn-completed', turn));
    let cursor = 0;
    for (let offset = 0; offset < events.length; offset += 500) cursor = await f.repo.apply(f.taskId, cursor, events.slice(offset, offset + 500));
    expect((await f.repo.read(f.taskId, f.user, { limit: 10 })).states[0]?.pending[0]?.unread).toBe(true);
    expect(await f.repo.markRead(f.taskId, f.user, { agentId: f.agentId, turnId: 'turn-1', throughSeq: 30 })).toBe(30);
    await f.repo.apply(f.taskId, cursor, [f.event('turn-started', 1004), f.event('turn-completed', 1004)]);
    expect((await f.repo.read(f.taskId, f.user, { limit: 10 })).states[0]?.pending[0]).toMatchObject({ id: 'old-question', unread: false });
    expect((await f.repo.read(f.taskId, f.other, { limit: 10 })).states[0]?.pending[0]?.unread).toBe(true);
  }, 15000);
});
