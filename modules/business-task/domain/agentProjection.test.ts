import { expect, test } from 'bun:test';
import type { AgentEvent, BusinessSubtaskV3Dto, RunnerBusinessEvent, TaskId, SubtaskId } from '@crewstation/contracts';
import { BusinessEventSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { appendCommandSummary, projectCommandEvent } from './commandProjection';

const taskId = newResourceId() as TaskId, subtaskId = newResourceId() as SubtaskId;
const initial: BusinessSubtaskV3Dto = { id: subtaskId, taskId, name: 'review', kind: 'agent', attempt: 1, state: 'running', process: 'live', executionId: newResourceId(), createdAt: new Date().toISOString() };
const input = (event: Partial<AgentEvent>): RunnerBusinessEvent => ({ sequence: 1, occurredAt: initial.createdAt, frame: { type: 'agent', event: { agentId: initial.executionId, seq: 1, at: initial.createdAt, type: 'text', ...event } } });
const summary = { stdout: '', stderr: '', truncated: false };

test('Agent text, tool calls, native session and usage map to validated durable business events', () => {
  const text = input({ text: 'answer' });
  expect(appendCommandSummary(summary, text).stdout).toBe('answer');
  expect(projectCommandEvent(initial, text, 'cursor', summary).event).toMatchObject({ type: 'text', data: { text: 'answer' } });
  const session = projectCommandEvent(initial, input({ type: 'session', sessionId: 'native' }), 'cursor', summary);
  expect(session.view.sessionId).toBe('native'); expect(session.event.type).toBe('session');
  for (const event of [input({ type: 'tool-start', tool: { callId: 'call', name: 'Read', input: { path: 'a' } } }), input({ type: 'tool-end', tool: { callId: 'call', name: 'Read', output: 'done' } })]) expect(BusinessEventSchema.safeParse(projectCommandEvent(initial, event, 'cursor', summary).event).success).toBe(true);
  const usage = projectCommandEvent(initial, input({ type: 'usage', usage: { measurementId: 'same', scope: 'step', mode: 'cumulative', inputTokens: null, outputTokens: 2, cacheReadTokens: null, cacheWriteTokens: null, complete: false } }), 'cursor', summary).event;
  expect(usage).toMatchObject({ type: 'usage', data: { measurementId: `${initial.executionId}:same`, scope: `${initial.executionId}:step`, inputTokens: null } });
  expect(BusinessEventSchema.safeParse(usage).success).toBe(true);
});

test('waiting stays live; CLI completion is verifying until final durable watermark, errors never become success', () => {
  expect(projectCommandEvent(initial, input({ type: 'status', status: 'waiting' }), 'cursor', summary).view).toMatchObject({ state: 'awaiting-input', process: 'live' });
  const completed = projectCommandEvent(initial, input({ type: 'completed' }), 'cursor', summary).view;
  expect(completed).toMatchObject({ state: 'verifying', process: 'live' }); expect(completed.result).toBeUndefined();
  const failed = projectCommandEvent(initial, input({ type: 'error', error: { code: 'provider_failed', message: 'rejected' } }), 'cursor', summary).view;
  const final = projectCommandEvent(failed, { sequence: 2, occurredAt: initial.createdAt, frame: { type: 'result', result: { exitCode: 0, reason: 'agent_failed', durationMs: 10 } } }, 'final', summary);
  expect(final.view).toMatchObject({ state: 'failed', process: 'exited', error: { code: 'provider_failed' } });
  expect(BusinessEventSchema.safeParse(final.event).success).toBe(true);
});
