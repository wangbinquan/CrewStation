import { expect, test } from 'bun:test';
import { ApiClientError } from '@crewstation/api-client';
import type { AgentActivityPage } from '@crewstation/contracts';
import { activityCounts, activityStatus, taskEntries } from '../shared/activity/agentActivityView';
import { activityFixture, activityProjectId, activityTaskId, activityTime } from './agentActivityFixture';

test('后台请求只通知一次，个人查看不消除等待；新轮次与旧未读结果分别计数', async () => {
  const f = activityFixture(); await f.register();
  const firstNotice = f.store.getSnapshot().notice;
  expect(firstNotice?.count).toBe(1); expect(activityCounts(f.store.getSnapshot().tasks[0])).toEqual({ pending: 1, completions: 0, running: 0 });
  f.store.dismissNotice(firstNotice!.id); await f.store.refresh(activityTaskId);
  expect(f.store.getSnapshot().notice).toBeNull();
  await f.store.read(activityTaskId, { agentId: f.terminal.agentId, turnId: 'turn-one', throughSeq: 3 });
  expect(taskEntries(f.store.getSnapshot().tasks[0]!)[0]).toMatchObject({ kind: 'request-opened', unread: false });
  expect(activityCounts(f.store.getSnapshot().tasks[0]).pending).toBe(1);
  f.page.states[0]!.pending = []; f.page.states[0]!.currentTurn!.status = 'completed';
  f.page.items = [{ eventId: 'done-one', agentId: f.terminal.agentId, terminalId: f.terminal.terminalId, runnerId: f.terminal.runnerId, seq: 5, turnId: 'turn-one', kind: 'turn-completed', occurredAt: activityTime, unread: true }];
  f.page.unread = [{ agentId: f.terminal.agentId, completions: 1, issues: 0 }];
  await f.store.refresh(activityTaskId);
  expect(f.store.getSnapshot().notice?.count).toBe(1); expect(activityStatus(f.terminal, f.page.states[0], f.page)).toBe('completed');
  f.page.states[0]!.currentTurn = { ...f.page.states[0]!.currentTurn!, turnId: 'turn-two', ordinal: 2, status: 'running' };
  await f.store.refresh(activityTaskId);
  expect(activityCounts(f.store.getSnapshot().tasks[0])).toEqual({ pending: 0, completions: 1, running: 1 });
  expect(activityCounts(f.store.getSnapshot().tasks[0], ['other-terminal'])).toEqual({ pending: 0, completions: 0, running: 0 });
});

test('未知来源和断线不呈现本轮成功；确定进程退出仍显示结束，启动失败不混同轮次失败', () => {
  const f = activityFixture(); f.page.states[0]!.pending = []; f.page.states[0]!.currentTurn!.status = 'completed';
  expect(activityStatus(f.terminal, f.page.states[0], { ...f.page, sync: 'catching-up' })).toBe('unknown');
  expect(activityStatus(f.terminal, { ...f.page.states[0]!, source: 'unavailable' }, f.page)).toBe('unknown');
  expect(activityStatus(f.terminal, f.page.states[0], f.page, true)).toBe('unknown');
  expect(activityStatus(f.terminal, { ...f.page.states[0]!, processEnded: true }, f.page, true)).toBe('ended');
  expect(activityStatus({ ...f.terminal, lifecycle: 'failed' }, undefined, undefined, true)).toBe('start-failed');
  f.page.states[0]!.currentTurn!.status = 'failed'; expect(activityStatus(f.terminal, f.page.states[0], f.page)).toBe('failed');
});

test('请求合并、失败保留上次记录并降级，查看资格撤销时立即移除该任务', async () => {
  const f = activityFixture(); await f.register();
  f.source.page = async () => { throw new Error('offline'); };
  await f.store.refresh(activityTaskId);
  expect(f.store.getSnapshot().tasks[0]).toMatchObject({ stale: true, error: 'offline' });
  expect(taskEntries(f.store.getSnapshot().tasks[0]!)[0]?.uncertain).toBe(true);
  f.source.page = async () => { throw new ApiClientError(403, { error: 'forbidden', message: 'revoked', details: {} }); };
  await f.store.refresh(activityTaskId); expect(f.store.getSnapshot().tasks).toEqual([]);
});

test('StrictMode 清理后可重新挂载，旧请求和旧身份的迟到结果不能写回', async () => {
  const f = activityFixture(); let resolve!: (page: AgentActivityPage) => void;
  f.source.page = () => new Promise((done) => { resolve = done; });
  f.store.register(activityTaskId, activityProjectId, '旧挂载'); const old = f.store.refresh(activityTaskId);
  f.store.dispose(); f.source.page = async () => ({ ...f.page, items: [], states: [], unread: [] });
  await f.register(); resolve(f.page); await old;
  expect(f.store.getSnapshot().tasks[0]?.name).toBe('验收应用'); expect(f.store.getSnapshot().tasks[0]?.page?.states).toEqual([]);
  expect(f.store.getSnapshot().notice).toBeNull();
});

test('已读写入之后重新读取，较早发出的旧响应不会最终恢复未读', async () => {
  const f = activityFixture(); await f.register();
  let resolve!: (page: AgentActivityPage) => void; const oldPage = structuredClone(f.page), original = f.source.page;
  f.source.page = () => new Promise((done) => { resolve = done; });
  const old = f.store.refresh(activityTaskId);
  const reading = f.store.read(activityTaskId, { agentId: f.terminal.agentId, turnId: 'turn-one', throughSeq: 3 });
  await Promise.resolve(); f.source.page = original; resolve(oldPage); await old; await reading;
  expect(f.store.getSnapshot().tasks[0]?.page?.states[0]?.pending[0]?.unread).toBe(false);
});

test('更早未读页同样刷新本人已读；错误身份响应不覆盖现有状态', async () => {
  const f = activityFixture(); await f.register();
  await f.store.older(activityTaskId, 10); await f.store.refresh(activityTaskId);
  expect(f.pageCalls.filter((before) => before === 10)).toHaveLength(2);
  f.source.page = async () => ({ ...f.page, projectId: `prj_${'9'.repeat(32)}` as AgentActivityPage['projectId'] });
  await f.store.refresh(activityTaskId);
  expect(f.store.getSnapshot().tasks[0]).toMatchObject({ stale: true, error: 'activity.identityMismatch', page: { projectId: activityProjectId } });
});
