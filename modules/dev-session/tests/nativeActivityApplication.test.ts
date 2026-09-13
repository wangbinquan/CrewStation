import { expect, test } from 'bun:test';
import type { AgentActivityState, NativeTerminalRoster } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';
import { nativeActivityUseCases } from '../application/nativeActivity';
import type { NativeActivityRead, NativeActivityRepository, StoredNativeEvent } from '../ports/nativeActivity';
import { checkedAt, workspaceActor, workspaceFixture, workspaceTask } from './workspaceFixture';

function fixture() {
  const f = workspaceFixture();
  const roster: NativeTerminalRoster = { runnerId: crypto.randomUUID(), terminals: [] };
  const data: NativeActivityRead = { items: [], states: [], unread: [], nextCursor: 0, hasMore: false, throughSeq: 0, historyTruncated: false };
  const accesses: string[] = [];
  let through = 0;
  const repository: NativeActivityRepository = {
    cursor: async () => through,
    apply: async (_task, _since, events) => { through = events.at(-1)?.seq ?? through; return through; },
    read: async (_task, user) => { accesses.push(user); return structuredClone(data); },
    markRead: async (_task, user, input) => { accesses.push(user); return input.throughSeq; },
  };
  f.state.result = roster;
  return { ...f, roster, data, accesses, repository, api: nativeActivityUseCases(f.deps, repository) };
}

test('状态来源失败仍返回持久历史；离线、活跃往返失败不能冒充连接成功', async () => {
  const f = fixture(); f.state.connected = false;
  f.deps.runner.listEvents = async () => { throw new Error('source offline'); };
  expect(await f.api.getAgentActivity(workspaceActor, workspaceTask, { limit: 20 })).toMatchObject({ sync: 'unavailable', connection: 'disconnected', items: [], checkedAt });
  expect(f.commands).toHaveLength(0);
  f.state.connected = true; f.state.result = {};
  expect((await f.api.getAgentActivity(workspaceActor, workspaceTask, { limit: 20 })).connection).toBe('unknown');
  f.state.result = f.roster;
  expect((await f.api.getAgentActivity(workspaceActor, workspaceTask, { limit: 20 })).connection).toBe('connected');
});

test('并发读取合并同任务补齐，最多四个有界批次，剩余历史明确仍在同步', async () => {
  const f = fixture(); let calls = 0;
  f.deps.runner.listEvents = async (_task, query) => {
    calls++; expect(query).toMatchObject({ kinds: ['nativeActivity', 'nativeTerminal'], limit: 500 });
    await Promise.resolve();
    return Array.from({ length: 500 }, (_, index): StoredNativeEvent => ({ seq: (query?.sinceSeq ?? 0) + index + 1, at: checkedAt, event: { kind: 'previewState', state: 'stopped' } }));
  };
  const pages = await Promise.all([f.api.getAgentActivity(workspaceActor, workspaceTask, { limit: 10 }), f.api.getAgentActivity(workspaceActor, workspaceTask, { limit: 10 })]);
  expect(calls).toBe(4); expect(pages.map((page) => page.sync)).toEqual(['catching-up', 'catching-up']);
  expect(await f.repository.cursor(workspaceTask)).toBe(2000);
});

test('卡住的源查询有界返回；迟到结果不会在超时后继续写入投影', async () => {
  const f = fixture(); let release!: (events: StoredNativeEvent[]) => void, applied = 0;
  f.deps.runner.listEvents = () => new Promise((resolve) => { release = resolve; });
  f.repository.apply = async () => { applied++; return 99; };
  expect((await f.api.getAgentActivity(workspaceActor, workspaceTask, { limit: 10 })).sync).toBe('unavailable');
  release([]); await Promise.resolve(); await Promise.resolve();
  expect(applied).toBe(0);
}, 4000);

test('Runner 代次变化和实际退出压过旧等待，但历史结果不被改写', async () => {
  const f = fixture();
  const state: AgentActivityState = { agentId: 'agent', terminalId: 'terminal', runnerId: crypto.randomUUID(), throughSeq: 3, source: 'ready', currentTurn: { turnId: 'turn', ordinal: 1, status: 'waiting', startedAt: checkedAt, updatedAt: checkedAt }, pending: [{ id: 'q', eventId: 'e', turnId: 'turn', kind: 'question', openedAt: checkedAt, seq: 3 }], processEnded: false, updatedAt: checkedAt };
  f.data.states = [state];
  f.data.items = [{ eventId: 'e', agentId: state.agentId, terminalId: state.terminalId, runnerId: state.runnerId, seq: 3, turnId: 'turn', kind: 'request-opened', occurredAt: checkedAt, request: { id: 'q', kind: 'question' }, unread: true }];
  const page = await f.api.getAgentActivity(workspaceActor, workspaceTask, { limit: 10 });
  expect(page.states[0]).toMatchObject({ processEnded: true, pending: [], currentTurn: { status: 'waiting' } });
  expect(page.items[0]?.unread).toBe(false);
  expect(f.data.states[0]?.pending).toHaveLength(1);
  f.roster.runnerId = state.runnerId;
  f.roster.terminals.push({ agentId: state.agentId, terminalId: state.terminalId, runnerId: state.runnerId, lifecycle: 'ended', revision: 2, compute: 'balanced', permission: 'edit', startedAt: checkedAt, endedAt: checkedAt, cols: 80, rows: 24 });
  expect((await f.api.getAgentActivity(workspaceActor, workspaceTask, { limit: 10 })).states[0]?.processEnded).toBe(true);
});

test('查询前后校验查看资格；已读严格绑定调用者，不执行任何 Runner 操作', async () => {
  const f = fixture(); let authorized = 0;
  f.deps.authorizer.authorize = async () => { authorized++; if (authorized > 1) throw forbidden(); };
  await expect(f.api.getAgentActivity(workspaceActor, workspaceTask, { limit: 10 })).rejects.toMatchObject({ kind: 'forbidden' });
  f.accesses.length = 0; f.commands.length = 0;
  await expect(f.api.readAgentActivity(workspaceActor, workspaceTask, { agentId: 'a', turnId: 't', throughSeq: 1 })).rejects.toMatchObject({ kind: 'forbidden' });
  expect(f.accesses).toEqual([]);
  f.deps.authorizer.authorize = async () => {};
  expect(await f.api.readAgentActivity(workspaceActor, workspaceTask, { agentId: 'a', turnId: 't', throughSeq: 1 })).toEqual({ throughSeq: 1 });
  expect(f.accesses).toEqual([workspaceActor.userId]); expect(f.commands).toEqual([]);
});
