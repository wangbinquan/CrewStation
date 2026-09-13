import { expect, test } from 'bun:test';
import type { NativeActivityEvent, NativeActivitySignal, NativeTerminalRecord } from '@crewstation/contracts';
import { AgentActivityStateSchema } from '@crewstation/contracts';
import { initialNativeActivity, projectNativeActivity, projectNativeLifecycle } from '../domain/nativeActivityProjection';

function fixture() {
  const record: NativeTerminalRecord = { agentId: 'agent', terminalId: 'terminal', runnerId: crypto.randomUUID(), compute: 'balanced', permission: 'edit', revision: 1, lifecycle: 'running', startedAt: '2026-09-13T01:00:00.000Z', cols: 80, rows: 24 };
  let projection = initialNativeActivity(record), seq = 0;
  const apply = (kind: NativeActivitySignal['kind'], ordinal = 0, fields: Partial<NativeActivitySignal> = {}) => {
    const current = ++seq;
    const input: NativeActivityEvent = {
      agentId: record.agentId, terminalId: record.terminalId, runnerId: record.runnerId, seq: current, eventId: `event-${current}`, turnOrdinal: ordinal,
      signal: { source: 'claude-code/2.1.268', kind, nativeSessionId: ordinal ? 'session' : null, turnId: ordinal ? `turn-${ordinal}` : null, occurredAt: record.startedAt, sourceEventId: `source-${current}`, ...fields },
    };
    const result = projectNativeActivity(projection, input, current * 10); projection = result.projection;
    AgentActivityStateSchema.parse(projection.state);
    return { ...result, input };
  };
  return { record, apply, get: () => projection };
}

test('连接／进程独立，轮次开始、多个问题、全部解决与完成按真实事件推进', () => {
  const f = fixture(); f.apply('source-ready'); f.apply('turn-started', 1);
  expect(f.get().state.currentTurn?.status).toBe('running');
  f.apply('request-opened', 1, { request: { id: 'one', kind: 'question' } });
  f.apply('request-opened', 1, { request: { id: 'two', kind: 'permission' } });
  expect(f.get().state.currentTurn?.status).toBe('waiting');
  f.apply('request-resolved', 1, { request: { id: 'one', kind: 'question', resolution: 'answered' } });
  expect(f.get().state.currentTurn?.status).toBe('waiting');
  f.apply('request-resolved', 1, { request: { id: 'two', kind: 'permission', resolution: 'withdrawn' } });
  expect(f.get().state.currentTurn?.status).toBe('running');
  const before = structuredClone(f.get()); f.apply('turn-completed', 1);
  expect(before.state.currentTurn?.status).toBe('running');
  expect(f.get().state.currentTurn?.status).toBe('completed'); expect(f.get().state.processEnded).toBe(false);
  f.apply('process-ended'); expect(f.get().state.processEnded).toBe(true);
});

test('旧轮次完成可进入历史，不能覆盖新轮次执行；后到的明确结果补齐未确认', () => {
  const f = fixture(); f.apply('source-ready'); f.apply('turn-started', 1); f.apply('turn-unconfirmed', 1); f.apply('turn-started', 2);
  expect(f.apply('turn-completed', 1).item).toMatchObject({ turnId: 'turn-1', kind: 'turn-completed' });
  expect(f.get().state.currentTurn).toMatchObject({ turnId: 'turn-2', status: 'running' });
  expect(f.apply('turn-unconfirmed', 1).item).toBeUndefined();
  expect(f.get().turns.find((turn) => turn.turnId === 'turn-1')?.status).toBe('completed');
});

test('语义重复不重发动态；确定结果冲突降级，过期问题不能重新进入待处理', () => {
  const f = fixture(); f.apply('source-ready'); f.apply('turn-started', 1);
  expect(f.apply('turn-started', 1).item).toBeUndefined();
  const request = { id: 'q', kind: 'question' as const };
  f.apply('request-opened', 1, { request });
  expect(f.apply('request-opened', 1, { request }).item).toBeUndefined();
  f.apply('request-resolved', 1, { request: { ...request, resolution: 'answered' } });
  expect(f.apply('request-resolved', 1, { request: { ...request, resolution: 'answered' } }).item).toBeUndefined();
  f.apply('turn-completed', 1);
  expect(f.apply('turn-completed', 1).item).toBeUndefined();
  expect(f.apply('request-opened', 1, { request }).item).toBeUndefined();
  expect(f.get().state.pending).toEqual([]);
  expect(f.apply('turn-failed', 1).item).toBeUndefined();
  expect(f.get().state.source).toBe('unavailable');
});

test('退出名册可独立关闭状态，但不会产生轮次成功或重复的进程结束', () => {
  const f = fixture(); f.apply('source-ready'); f.apply('turn-started', 1);
  f.apply('request-opened', 1, { request: { id: 'q', kind: 'permission' } });
  const result = projectNativeLifecycle(f.get(), { ...f.record, revision: 2, lifecycle: 'ended' }, 100, f.record.startedAt);
  expect(result.projection.state).toMatchObject({ processEnded: true, pending: [], currentTurn: { status: 'waiting' } });
  expect(result.item).toMatchObject({ kind: 'process-ended', turnId: null });
  expect(projectNativeLifecycle(result.projection, { ...f.record, revision: 2, lifecycle: 'ended' }, 110, f.record.startedAt).item).toBeUndefined();
});

test('重复／旧源序号和其他进程被忽略，缺口后不产生成功动态', () => {
  const f = fixture(); f.apply('source-ready'); const started = f.apply('turn-started', 1);
  expect(projectNativeActivity(f.get(), started.input, 30).item).toBeUndefined();
  expect(projectNativeActivity(f.get(), { ...started.input, runnerId: crypto.randomUUID(), seq: 3 }, 30).projection).toBe(f.get());
  const missing = { ...started.input, seq: 4, signal: { ...started.input.signal, kind: 'turn-completed' as const } };
  const result = projectNativeActivity(f.get(), missing, 40);
  expect(result.projection.state).toMatchObject({ source: 'unavailable', sourceReason: 'channel-gap' });
  expect(result.item).toBeUndefined();
});

test('未收到可靠来源或轮次身份时不得显示成功，进程退出仍保留确定事实并消除旧待处理', () => {
  const f = fixture(); f.apply('turn-completed', 1);
  expect(f.get().state.source).toBe('unavailable'); expect(f.get().state.currentTurn).toBeNull();
  f.apply('source-ready'); expect(f.get().state.source).toBe('unavailable');
  const g = fixture(); g.apply('source-ready'); g.apply('turn-started', 1); g.apply('request-opened', 1, { request: { id: 'q', kind: 'question' } });
  g.apply('process-ended'); expect(g.get().state.pending).toEqual([]);
  expect(g.apply('turn-completed', 1).item).toBeUndefined();
});
