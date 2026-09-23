import { describe, expect, test } from 'bun:test';
import type { RunnerEvent } from '@crewstation/contracts';
import { toTraceEvent, TRACE_TEXT_LIMIT } from './traceEvents';

const at = '2026-09-23T10:00:00.000Z';
const stored = (event: RunnerEvent, seq = 3) => ({ seq, at, event });
const agent = (type: string, extra: Record<string, unknown> = {}): RunnerEvent => ({ kind: 'agent', event: { agentId: 'a', seq: 1, at: '2026-09-23T10:00:01.000Z', type, ...extra } as never });

describe('回放事件的映射', () => {
  test('Agent 事件保留类型、文字、工具、状态、错误、会话与退出码，时间取事件自己的时间', () => {
    expect(toTraceEvent(stored(agent('text', { text: '分析完成', sessionId: 'ses_1' })))).toEqual({ seq: 3, at: '2026-09-23T10:00:01.000Z', kind: 'agent', type: 'text', text: '分析完成', sessionId: 'ses_1' });
    expect(toTraceEvent(stored(agent('tool-end', { tool: { name: 'bash', isError: true, output: 'secret' } })))).toMatchObject({ type: 'tool-end', tool: { name: 'bash', isError: true } });
    expect(toTraceEvent(stored(agent('completed', { result: { summary: '完成', exitCode: 0 } })))).toMatchObject({ type: 'completed', text: '完成', exitCode: 0 });
    expect(toTraceEvent(stored(agent('error', { error: { message: '额度用尽' }, status: 'failed' })))).toMatchObject({ error: '额度用尽', status: 'failed' });
  });

  test('思考事件不带文字（Design §14.2 默认不保留推理内容）；过长的文字截断', () => {
    expect(toTraceEvent(stored(agent('thinking', { text: '内部推理' })))).toEqual({ seq: 3, at: '2026-09-23T10:00:01.000Z', kind: 'agent', type: 'thinking' });
    const long = toTraceEvent(stored(agent('text', { text: 'x'.repeat(TRACE_TEXT_LIMIT + 5) })))!;
    expect(long.text).toHaveLength(TRACE_TEXT_LIMIT + 1);
    expect(long.text!.endsWith('…')).toBe(true);
  });

  test('启动前步骤给出状态、出错那一步的名字与原因；CLI 活动信号给出种类与原生会话；终端关闭给出退出码', () => {
    const beforeStart = { kind: 'beforeStart', execution: { executionId: 'e', agentId: 'a', processAttemptId: 'p', profile: { profileId: 'x', revision: 1 }, state: 'failed', queuedAt: at,
      steps: [{ stepId: 's1', name: '写配置', kind: 'file', state: 'succeeded' }, { stepId: 's2', name: '装依赖', kind: 'script', state: 'failed' }], error: { code: 'script_failed', message: '退出码 1', stepId: 's2' } } } as unknown as RunnerEvent;
    expect(toTraceEvent(stored(beforeStart))).toEqual({ seq: 3, at, kind: 'before-start', status: 'failed', text: '装依赖', error: '退出码 1' });
    const activity = { kind: 'nativeActivity', activity: { signal: { kind: 'turn-completed', occurredAt: '2026-09-23T10:00:02.000Z', nativeSessionId: 'native-1' } } } as unknown as RunnerEvent;
    expect(toTraceEvent(stored(activity))).toEqual({ seq: 3, at: '2026-09-23T10:00:02.000Z', kind: 'activity', status: 'turn-completed', sessionId: 'native-1' });
    expect(toTraceEvent(stored({ kind: 'terminalClosed', terminalId: 't', exitCode: null }))).toEqual({ seq: 3, at, kind: 'terminal-closed', exitCode: null });
  });

  test('平台自己执行的命令与终端输出不进回放', () => {
    expect(toTraceEvent(stored({ kind: 'execExited', execId: 'git-1', exitCode: 0, durationMs: 2 }))).toBeUndefined();
    expect(toTraceEvent(stored({ kind: 'terminalOutput', terminalId: 't', data: 'ls' }))).toBeUndefined();
  });
});
