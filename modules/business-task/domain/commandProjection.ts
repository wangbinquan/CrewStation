import { projectAgentFrame } from './agentProjection';
import type { BusinessEvent, BusinessSubtaskV3Dto, RunnerBusinessEvent } from '@crewstation/contracts';
import { BUSINESS_EXECUTION_LIMITS } from '@crewstation/contracts';

export interface CommandSummary { stdout: string; stderr: string; truncated: boolean }
/** Summary truncation never discards the separately archived output event. */
export function appendCommandSummary(summary: CommandSummary, event: RunnerBusinessEvent): CommandSummary {
  if (event.frame.type === 'agent' && event.frame.event.type === 'text') return appendCommandSummary(summary, { ...event, frame: { type: 'output', stream: 'stdout', text: event.frame.event.text ?? '' } });
  if (event.frame.type !== 'output') return summary;
  const remaining = Math.max(0, BUSINESS_EXECUTION_LIMITS.summaryBytes - Buffer.byteLength(summary.stdout) - Buffer.byteLength(summary.stderr));
  const encodedRemaining = Math.max(0, BUSINESS_EXECUTION_LIMITS.eventBytes - 4096 - Buffer.byteLength(JSON.stringify(summary.stdout)) - Buffer.byteLength(JSON.stringify(summary.stderr)));
  const bytes = Buffer.from(event.frame.text), slice = bytes.subarray(0, remaining);
  // A streaming decode keeps an incomplete UTF-8 tail out of the summary.
  const decoded = new TextDecoder().decode(slice, { stream: bytes.length > remaining });
  const text = fitEncodedText(decoded, encodedRemaining);
  return { ...summary, [event.frame.stream]: summary[event.frame.stream] + text, truncated: summary.truncated || bytes.length > remaining || text !== decoded };
}
/** JSON escaping counts against the event ceiling too (control characters can expand sixfold). */
function fitEncodedText(text: string, limit: number): string {
  if (Buffer.byteLength(JSON.stringify(text)) - 2 <= limit) return text;
  let low = 0, high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(JSON.stringify(text.slice(0, middle))) - 2 <= limit) low = middle; else high = middle - 1;
  }
  if (low && /[\uD800-\uDBFF]/u.test(text[low - 1]!)) low--;
  return text.slice(0, low);
}
export function projectCommandEvent(view: BusinessSubtaskV3Dto, input: RunnerBusinessEvent, cursor: string, summary: CommandSummary): { event: BusinessEvent; view: BusinessSubtaskV3Dto } {
  const common = { taskId: view.taskId, subtaskId: view.id, attempt: view.attempt, cursor, occurredAt: input.occurredAt, sourceEventId: `${view.executionId}:${input.sequence}` };
  const frame = input.frame;
  if (frame.type === 'agent') return projectAgentFrame(view, frame.event, common);
  if (frame.type === 'output') return { view, event: { ...common, type: 'output', data: { stream: frame.stream, text: frame.text } } };
  if (frame.type === 'state') {
    const next: BusinessSubtaskV3Dto = { ...view, state: frame.state, process: 'live', startedAt: view.startedAt ?? input.occurredAt, error: undefined };
    return { view: next, event: { ...common, type: 'execution-state', data: { state: next.state, process: next.process } } };
  }
  const state = frame.result.reason === 'cancelled' ? 'cancelled' : frame.result.reason === 'exited' && frame.result.exitCode === 0 ? 'succeeded' : 'failed';
  const result = { exitCode: frame.result.exitCode, reason: frame.result.reason, ...summary, files: [], finalCursor: cursor };
  return { view: { ...view, state, process: 'exited', endedAt: input.occurredAt, result, error: state === 'failed' ? view.error : undefined }, event: { ...common, type: 'result', data: result } };
}
