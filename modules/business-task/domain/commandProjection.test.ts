import { expect, test } from 'bun:test';
import type { BusinessSubtaskV3Dto, RunnerBusinessEvent } from '@crewstation/contracts';
import { BUSINESS_EXECUTION_LIMITS, SubtaskIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { appendCommandSummary, projectCommandEvent } from './commandProjection';

const view: BusinessSubtaskV3Dto = { id: SubtaskIdSchema.parse(newResourceId()), taskId: TaskIdSchema.parse(newResourceId()), executionId: newResourceId(), attempt: 1, name: 'command', kind: 'command', state: 'running', process: 'live', createdAt: new Date().toISOString() };
const frame = (text: string): RunnerBusinessEvent => ({ sequence: 1, occurredAt: view.createdAt, frame: { type: 'output', stream: 'stdout', text } });
test('summary remains valid UTF-8 and final event fits the byte ceiling, including JSON escape expansion', () => {
  for (const text of ['a'.repeat(240_000), '🙂'.repeat(50_000), '\u0001'.repeat(30_000)]) {
    let summary = { stdout: '', stderr: '', truncated: false };
    for (let i = 0; i < 3; i++) summary = appendCommandSummary(summary, frame(text));
    expect(summary.truncated).toBe(true);
    expect(Buffer.byteLength(summary.stdout) + Buffer.byteLength(summary.stderr)).toBeLessThanOrEqual(BUSINESS_EXECUTION_LIMITS.summaryBytes);
    expect(summary.stdout).not.toContain('\ufffd');
    const result = projectCommandEvent(view, { sequence: 4, occurredAt: view.createdAt, frame: { type: 'result', result: { exitCode: 0, reason: 'exited', durationMs: 1 } } }, 'cursor', summary);
    expect(Buffer.byteLength(JSON.stringify(result.event))).toBeLessThan(BUSINESS_EXECUTION_LIMITS.eventBytes);
    expect(result.view.state).toBe('succeeded'); expect(result.view.result?.truncated).toBe(true);
  }
});
test('exit reason determines terminal state while a raw output event is retained in full', () => {
  const output = frame('whole event'), summary = appendCommandSummary({ stdout: '', stderr: '', truncated: false }, output);
  expect(projectCommandEvent(view, output, 'cursor', summary).event).toMatchObject({ type: 'output', data: { text: 'whole event' } });
  for (const [reason, exitCode, state] of [['cancelled', null, 'cancelled'], ['timeout', null, 'failed'], ['exited', 1, 'failed']] as const) {
    expect(projectCommandEvent(view, { sequence: 2, occurredAt: view.createdAt, frame: { type: 'result', result: { exitCode, reason, durationMs: 1 } } }, 'final', summary).view.state).toBe(state);
  }
});
