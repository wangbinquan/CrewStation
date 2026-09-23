import { describe, expect, test } from 'bun:test';
import type { SubtaskId, TaskId, TraceId } from '@crewstation/contracts';
import type { TraceParts } from './traceAssembly';
import { assembleChain, groupTraceParts, latestAttempts, summarizeTrace, tracePosition, traceStatus } from './traceAssembly';
import type { TraceBusinessTaskPart, TraceDeliveryPart, TraceEnvironmentPart, TraceSubtaskPart } from './traceParts';

const T = 'a'.repeat(32) as TraceId;
const t = (minute: number) => new Date(Date.UTC(2026, 8, 23, 10, minute)).toISOString();
const id = (n: number) => `01a0bf5d-8f4b-7${n.toString().padStart(3, '0')}-8b88-18362617594b` as TaskId;
const root = (n: number, kind: 'dev-session' | 'business', state: TraceEnvironmentPart['state'], minute = 0, extra: Partial<TraceEnvironmentPart> = {}): TraceEnvironmentPart =>
  ({ id: id(n), traceId: T, kind, state, createdAt: t(minute), updatedAt: t(minute + 5), lastActivityAt: t(minute + 4), ...extra });
const execution = (n: number, parent: number, purpose: 'cli' | 'agent' | 'subtask', state: TraceEnvironmentPart['state'], native: 'running' | 'finished', extra: Partial<NonNullable<TraceEnvironmentPart['native']>> = {}): TraceEnvironmentPart =>
  ({ ...root(n, purpose === 'subtask' ? 'business' : 'dev-session', state, 1), native: { purpose, parentTaskId: id(parent), agentId: `agent-${n}`, state: native, profile: { name: 'coding-medium' }, ...extra } });
const delivery = (state: TraceDeliveryPart['state'], minute = 0): TraceDeliveryPart =>
  ({ id: 'd1', eventId: id(90), eventType: 'gitlab.push', traceId: T, state, attempts: 1, createdAt: t(minute), updatedAt: t(minute + 1) });
const subtask = (n: number, state: TraceSubtaskPart['state'], extra: Partial<TraceSubtaskPart> = {}): TraceSubtaskPart =>
  ({ id: id(n) as unknown as SubtaskId, taskId: id(1), name: 'analysis', kind: 'agent', state, attempt: 1, createdAt: t(2), ...extra });
const business = (state: TraceBusinessTaskPart['state'], subtasks: TraceSubtaskPart[] = [], minute = 0): TraceBusinessTaskPart =>
  ({ id: id(1), traceId: T, state, callerIdentity: 'demo/demo', createdAt: t(minute), updatedAt: t(minute + 6), subtasks });
const parts = (p: Partial<TraceParts>): TraceParts => ({ environments: [], deliveries: [], businessTasks: [], ...p });

describe('调用链三档状态', () => {
  test('任何一部分还在进行就是进行中：环境、投递中（含等重试）、业务任务', () => {
    expect(traceStatus(parts({ environments: [root(1, 'dev-session', 'running')] }))).toBe('running');
    expect(traceStatus(parts({ deliveries: [delivery('retrying')] }))).toBe('running');
    expect(traceStatus(parts({ environments: [root(1, 'business', 'released')], businessTasks: [business('paused')] }))).toBe('running');
  });

  test('死信、业务任务失败、子任务最后一次尝试失败、会话容器失败算失败', () => {
    expect(traceStatus(parts({ deliveries: [delivery('dead')] }))).toBe('failed');
    expect(traceStatus(parts({ environments: [root(1, 'business', 'released')], businessTasks: [business('failed')] }))).toBe('failed');
    expect(traceStatus(parts({ environments: [root(1, 'business', 'released')], businessTasks: [business('closed', [subtask(2, 'failed')])] }))).toBe('failed');
    expect(traceStatus(parts({ environments: [root(1, 'dev-session', 'failed')] }))).toBe('failed');
  });

  test('重试成功、被取消的子任务，以及单个 CLI 执行失败，都不让整条链失败', () => {
    const retried = [subtask(2, 'failed'), subtask(3, 'succeeded', { attempt: 2, retryOf: id(2) as unknown as SubtaskId }), subtask(4, 'cancelled')];
    expect(latestAttempts(retried).map((s) => String(s.id))).toEqual([id(3), id(4)]);
    expect(traceStatus(parts({ environments: [root(1, 'business', 'released')], businessTasks: [business('closed', retried)] }))).toBe('ended');
    expect(traceStatus(parts({ environments: [root(1, 'dev-session', 'released'), execution(5, 1, 'cli', 'failed', 'finished', { failureReason: 'OOMKilled' })] }))).toBe('ended');
    expect(traceStatus(parts({ deliveries: [delivery('delivered')] }))).toBe('ended');
  });
});

describe('调用链列表的一行', () => {
  test('位置取任务环境与投递里最早的创建时间，业务任务记录不参与；两者都没有时不成行', () => {
    const p = parts({ deliveries: [delivery('delivered', 3)], environments: [root(1, 'business', 'released', 4)], businessTasks: [business('closed', [], 1)] });
    expect(tracePosition(T, p)).toEqual({ at: t(3), traceId: T });
    expect(summarizeTrace(T, parts({ businessTasks: [business('closed')] }))).toBeUndefined();
  });

  test('事件触发的业务任务合成一行：来源按「事件 → 业务任务」排列，子任务只数最后一次尝试', () => {
    const subtasks = [subtask(2, 'failed'), subtask(3, 'failed', { attempt: 2, retryOf: id(2) as unknown as SubtaskId }), subtask(4, 'succeeded', { endedAt: t(20) })];
    const row = summarizeTrace(T, parts({ deliveries: [delivery('delivered')], environments: [root(1, 'business', 'released', 1)], businessTasks: [business('closed', subtasks, 1)] }));
    expect(row).toEqual({
      traceId: T, status: 'failed', startedAt: t(0), lastActivityAt: t(20), sources: ['event', 'business-task'],
      event: { eventType: 'gitlab.push', state: 'delivered', attempts: 1 }, business: { tasks: 1, subtasks: 2, failedSubtasks: 1 },
    });
  });

  test('开发会话一行：谁建的、哪个分支、几个 CLI 与 headless Agent', () => {
    const row = summarizeTrace(T, parts({ environments: [
      root(1, 'dev-session', 'running', 0, { createdBy: '01a0bf5d-8f4b-7777-8b88-18362617594b', branch: 'main' }),
      execution(2, 1, 'cli', 'released', 'finished'), execution(3, 1, 'cli', 'running', 'running'), execution(4, 1, 'agent', 'released', 'finished'),
    ] }));
    expect(row).toMatchObject({ status: 'running', sources: ['dev-session'], devSession: { createdBy: '01a0bf5d-8f4b-7777-8b88-18362617594b', branch: 'main', clis: 2, agents: 1 } });
  });

  test('按 traceId 分组，组内保持来源给的顺序', () => {
    const other = { ...delivery('delivered'), id: 'd2', traceId: 'b'.repeat(32) };
    const groups = groupTraceParts(parts({ deliveries: [delivery('delivered'), other], environments: [root(1, 'business', 'released')] }));
    expect([...groups.keys()]).toEqual([T, 'b'.repeat(32)]);
    expect(groups.get(T)!.environments).toHaveLength(1);
    expect(groups.get('b'.repeat(32))!.deliveries.map((d) => d.id)).toEqual(['d2']);
  });
});

describe('调用链的分层回放', () => {
  test('任务下挂 Agent 执行与子任务：执行带汇总的会话与条数，子任务执行按执行环境对上，结束的带结束时间', () => {
    const subtasks = [subtask(2, 'failed', { executionTaskId: id(6), sessionId: 'ses_sub', error: '输出不符合契约', endedAt: t(8) })];
    const chain = assembleChain(T, parts({
      deliveries: [delivery('delivered')], environments: [root(1, 'business', 'released', 1), execution(6, 1, 'subtask', 'failed', 'finished', { failureReason: '容器运行失败' })],
      businessTasks: [{ ...business('closed', subtasks, 1), closedAt: t(9) }],
    }), new Map([[id(6), { taskId: id(6), events: 12, sessionIds: ['ses_agent', 'ses_sub'], protocol: 'opencode' }]]));
    expect(chain).toMatchObject({ status: 'failed', sources: ['event', 'business-task'], event: { deliveryId: 'd1', eventType: 'gitlab.push', state: 'delivered', createdAt: t(0) } });
    const task = chain!.tasks[0]!;
    expect(task).toMatchObject({ taskId: id(1), kind: 'business', status: 'failed', endedAt: t(9), business: { state: 'closed', callerIdentity: 'demo/demo', closedAt: t(9) } });
    expect(task.executions).toEqual([{
      taskId: id(6), purpose: 'subtask', agentId: 'agent-6', profileName: 'coding-medium', protocol: 'opencode', status: 'failed', startedAt: t(1), endedAt: t(6),
      failureReason: '容器运行失败', subtaskId: id(2) as unknown as SubtaskId, sessionIds: ['ses_agent', 'ses_sub'], events: 12,
    }]);
    expect(task.subtasks[0]).toMatchObject({ subtaskId: id(2), state: 'failed', error: '输出不符合契约', executionTaskId: id(6), endedAt: t(8) });
  });

  test('进行中的会话没有结束时间；没有汇总的执行条数为 0；只有业务任务记录时没有回放', () => {
    const chain = assembleChain(T, parts({ environments: [root(1, 'dev-session', 'running', 0, { branch: 'main' }), execution(2, 1, 'cli', 'running', 'running')] }), new Map());
    expect(chain!.tasks[0]).not.toHaveProperty('endedAt');
    expect(chain!.tasks[0]!.executions[0]).toMatchObject({ status: 'running', events: 0, sessionIds: [] });
    expect(chain!.tasks[0]!.executions[0]).not.toHaveProperty('endedAt');
    expect(assembleChain(T, parts({ businessTasks: [business('closed')] }), new Map())).toBeUndefined();
  });
});
