// RFC-034 v2 §4：Session 不存观测数据，只把 Runner 上报的执行快照与终态转交 Agent 执行记录；
// 转交按（执行环境, Agent）寻址、业务日志按序、写入失败只告警不影响事件持久化。
import { expect, test } from 'bun:test';
import type { AgentUsageSnapshot, RunnerBusinessEvent, TaskId } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import { noopLogger } from '@crewstation/kernel';
import { forwardBusinessEvents, forwardRunnerEvent } from '../application/agentCallForwarding';
import type { AgentCallSink } from '../ports/agentCallSink';

const runtime = '01a0bf5d-8f4b-7e20-82e1-9a99060b1192' as TaskId;
const snapshot: AgentUsageSnapshot = { state: 'partial', models: [{ model: 'zhipu/glm-5', input: 7, cacheRead: 0, cacheWrite: 0, output: 1, reasoning: 0 }] };
function recordingSink(fail = false) {
  const calls: unknown[] = [];
  const sink: AgentCallSink = {
    usage: async (target, value) => { calls.push(['usage', target, value]); if (fail) throw new Error('observability offline'); },
    finish: async (target, outcome) => { calls.push(['finish', target, outcome]); if (fail) throw new Error('observability offline'); },
  };
  return { sink, calls };
}
const agent = (seq: number, type: 'usage' | 'completed' | 'text', at: string) => ({ agentId: 'exec-1', seq, at, type, ...(type === 'text' ? { text: 'x' } : { usageSnapshot: snapshot }) });

test('Runner events are forwarded to the run in that environment; other events and a missing sink are ignored', async () => {
  const { sink, calls } = recordingSink(), at = new Date('2026-10-14T00:00:05.000Z');
  await forwardRunnerEvent(sink, noopLogger, runtime, { kind: 'agent', event: agent(1, 'usage', at.toISOString()) }, at);
  await forwardRunnerEvent(sink, noopLogger, runtime, { kind: 'agent', event: agent(2, 'completed', at.toISOString()) }, at);
  await forwardRunnerEvent(sink, noopLogger, runtime, { kind: 'agent', event: agent(3, 'text', at.toISOString()) }, at);
  await forwardRunnerEvent(undefined, noopLogger, runtime, { kind: 'agent', event: agent(4, 'completed', at.toISOString()) }, at);
  expect(calls).toEqual([
    ['usage', { runtimeTaskId: runtime, agentId: 'exec-1' }, snapshot],
    ['finish', { runtimeTaskId: runtime, agentId: 'exec-1' }, { status: 'done', at, snapshot }],
  ]);
});

test('business execution logs forward Agent frames in order with their own occurrence time', async () => {
  const { sink, calls } = recordingSink();
  const events: RunnerBusinessEvent[] = [
    { sequence: 1, occurredAt: '2026-10-14T00:00:01.000Z', frame: { type: 'state', state: 'running' } },
    { sequence: 2, occurredAt: '2026-10-14T00:00:02.000Z', frame: { type: 'agent', event: agent(1, 'usage', '2026-10-14T00:00:02.000Z') } },
    { sequence: 3, occurredAt: '2026-10-14T00:00:03.000Z', frame: { type: 'output', stream: 'stdout', text: 'log' } },
    { sequence: 4, occurredAt: '2026-10-14T00:00:04.000Z', frame: { type: 'agent', event: agent(2, 'completed', '2026-10-14T00:00:04.000Z') } },
  ];
  await forwardBusinessEvents(sink, noopLogger, runtime, events);
  expect(calls.map((call) => (call as [string])[0])).toEqual(['usage', 'finish']);
  expect((calls[1] as [string, unknown, { at: Date }])[2].at.toISOString()).toBe('2026-10-14T00:00:04.000Z');
});

test('an unavailable recorder only warns; forwarding never throws into event persistence', async () => {
  const { sink } = recordingSink(true), warnings: unknown[] = [];
  const logger: Logger = { ...noopLogger, warn: (message: string, fields?: Record<string, unknown>) => { warnings.push([message, fields]); } };
  await expect(forwardRunnerEvent(sink, logger, runtime, { kind: 'agent', event: agent(1, 'completed', '2026-10-14T00:00:00.000Z') }, new Date())).resolves.toBeUndefined();
  expect(warnings).toEqual([['agent call observation unavailable', { taskId: runtime, agentId: 'exec-1', error: 'observability offline' }]]);
});
