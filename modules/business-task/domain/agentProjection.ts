import type { AgentEvent, BusinessEvent, BusinessSubtaskV3Dto } from '@crewstation/contracts';

type Envelope = Pick<BusinessEvent, 'taskId' | 'subtaskId' | 'attempt' | 'cursor' | 'occurredAt' | 'sourceEventId'>;
/** The journal's final result closes output. CLI completed/error events alone cannot declare a durable result. */
export function projectAgentFrame(view: BusinessSubtaskV3Dto, input: AgentEvent, common: Envelope): { event: BusinessEvent; view: BusinessSubtaskV3Dto } {
  if (input.type === 'startup-inventory' && input.inventory) return { view, event: { ...common, type: 'startup-inventory', data: input.inventory } };
  if (input.type === 'text') return { view, event: { ...common, type: 'text', data: { text: input.text ?? '' } } };
  if (input.type === 'session' && input.sessionId) return { view: { ...view, sessionId: input.sessionId }, event: { ...common, type: 'session', data: { sessionId: input.sessionId } } };
  if (input.type === 'usage' && input.usage) return { view, event: { ...common, type: 'usage', data: { ...input.usage, scope: `${view.executionId}:${input.usage.scope}`, measurementId: `${view.executionId}:${input.usage.measurementId}` } } };
  // `opencode run --format json` reports a tool once, when its part is completed or errored, so the driver's
  // tool-start already carries the result. Projected as a start, the result was dropped and business clients
  // showed every OpenCode tool as still running (AW RFC-370 hosted acceptance, 2026-10-18).
  const finished = input.type === 'tool-start' && (input.tool?.output !== undefined || input.tool?.isError === true);
  if (input.type === 'tool-start' && input.tool && !finished) return { view, event: { ...common, type: 'tool-start', data: { callId: input.tool.callId ?? common.sourceEventId, name: input.tool.name, ...(input.tool.input === undefined ? {} : { input: input.tool.input }) } } };
  if ((input.type === 'tool-end' || finished) && input.tool) return { view, event: { ...common, type: 'tool-end', data: { callId: input.tool.callId ?? common.sourceEventId, name: input.tool.name, ...(input.tool.input === undefined ? {} : { input: input.tool.input }), ...(input.tool.output === undefined ? {} : { output: input.tool.output }), isError: input.tool.isError ?? false } } };
  const state = input.type === 'status' && input.status === 'waiting' ? 'awaiting-input' : input.type === 'completed' || input.type === 'cancelled' || input.type === 'error' ? 'verifying' : view.state === 'cancelling' ? 'cancelling' : 'running';
  const next: BusinessSubtaskV3Dto = { ...view, state, process: 'live', ...(input.error ? { error: { code: input.error.code ?? 'agent_failed', message: input.error.message } } : {}) };
  return { view: next, event: { ...common, type: 'execution-state', data: { state, process: next.process, ...(input.error ? { reason: input.error.code ?? 'agent_failed' } : {}) } } };
}
