// RFC-034 v2 §4：Session 从 Runner 事件认出执行快照与终态——runtime_error 不是终态；CLI 名册的结束原因映射为执行状态。
import { expect, test } from 'bun:test';
import type { AgentEvent, AgentUsageSnapshot, NativeTerminalRecord } from '@crewstation/contracts';
import { agentEventSignal, runnerEventSignal, terminalRecordSignal } from './agentCallSignals';

const snapshot: AgentUsageSnapshot = { state: 'complete', models: [{ model: 'zhipu/glm-5', input: 10, cacheRead: 0, cacheWrite: 0, output: 4, reasoning: 1 }] };
const event = (patch: Partial<AgentEvent>): AgentEvent => ({ agentId: 'agent-1', seq: 1, at: '2026-10-14T00:00:00.000Z', type: 'text', ...patch });
const terminal = (patch: Partial<NativeTerminalRecord>): NativeTerminalRecord => ({
  agentId: 'cli-1', terminalId: 't', runnerId: '01a0bf5d-8f4b-7e10-82e1-9a99060b1192', compute: 'glm', permission: 'edit', revision: 1, lifecycle: 'running',
  startedAt: '2026-10-14T00:00:00.000Z', cols: 80, rows: 24, ...patch,
} as NativeTerminalRecord);

test('Agent events: snapshots replace usage, completion/cancel/terminal errors end the run, a runtime error does not', () => {
  expect(agentEventSignal(event({ type: 'usage', usageSnapshot: snapshot }))).toEqual({ kind: 'usage', agentId: 'agent-1', snapshot });
  expect(agentEventSignal(event({ type: 'usage' }))).toBeNull();
  expect(agentEventSignal(event({ type: 'completed', usageSnapshot: snapshot }))).toEqual({ kind: 'finish', agentId: 'agent-1', status: 'done', snapshot });
  expect(agentEventSignal(event({ type: 'cancelled' }))).toEqual({ kind: 'finish', agentId: 'agent-1', status: 'canceled', snapshot: null });
  expect(agentEventSignal(event({ type: 'error', error: { code: 'spawn_failed', message: 'x' } }))).toMatchObject({ kind: 'finish', status: 'failed' });
  expect(agentEventSignal(event({ type: 'error', error: { code: 'runtime_error', message: 'retrying' } }))).toBeNull();
  expect(agentEventSignal(event({ type: 'text', text: 'hi' }))).toBeNull();
});

test('CLI roster records: running carries the latest snapshot, endings map their reason to a run status', () => {
  expect(terminalRecordSignal(terminal({ usage: snapshot }))).toEqual({ kind: 'usage', agentId: 'cli-1', snapshot });
  expect(terminalRecordSignal(terminal({}))).toBeNull();
  expect(terminalRecordSignal(terminal({ lifecycle: 'starting' }))).toBeNull();
  const ended = (patch: Partial<NativeTerminalRecord>) => terminalRecordSignal(terminal({ lifecycle: 'ended', usage: snapshot, ...patch }));
  expect(ended({ reason: 'exited', exitCode: 0 })).toEqual({ kind: 'finish', agentId: 'cli-1', status: 'done', snapshot });
  expect(ended({ reason: 'exited', exitCode: 2 })).toMatchObject({ status: 'failed' });
  expect(ended({ reason: 'stopped' })).toMatchObject({ status: 'canceled' });
  expect(ended({ reason: 'runner-restarted' })).toMatchObject({ status: 'interrupted' });
  expect(ended({ reason: 'environment-failed' })).toMatchObject({ status: 'failed' });
  expect(terminalRecordSignal(terminal({ lifecycle: 'failed', reason: 'start-failed' }))).toEqual({ kind: 'finish', agentId: 'cli-1', status: 'failed', snapshot: null });
});

test('only Agent and CLI roster frames carry run signals', () => {
  expect(runnerEventSignal({ kind: 'agent', event: event({ type: 'completed' }) })).toMatchObject({ kind: 'finish', status: 'done' });
  expect(runnerEventSignal({ kind: 'nativeTerminal', terminal: terminal({ usage: snapshot }) })).toMatchObject({ kind: 'usage', agentId: 'cli-1' });
});
