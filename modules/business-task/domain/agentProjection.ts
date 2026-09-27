import type { AgentEvent, BusinessEvent, BusinessSubtaskV3Dto } from '@crewstation/contracts';

type Envelope = Pick<BusinessEvent, 'taskId' | 'subtaskId' | 'attempt' | 'cursor' | 'occurredAt' | 'sourceEventId'>;
/** The journal's final result closes output. CLI completed/error events alone cannot declare a durable result. */
export function projectAgentFrame(view: BusinessSubtaskV3Dto, input: AgentEvent, common: Envelope): { event: BusinessEvent; view: BusinessSubtaskV3Dto } {
  if (input.type === 'text') return { view, event: { ...common, type: 'text', data: { text: input.text ?? '' } } };
  if (input.type === 'session' && input.sessionId) return { view: { ...view, sessionId: input.sessionId }, event: { ...common, type: 'session', data: { sessionId: input.sessionId } } };
  if (input.type === 'usage' && input.usage) return { view, event: { ...common, type: 'usage', data: { ...input.usage, scope: `${view.executionId}:${input.usage.scope}`, measurementId: `${view.executionId}:${input.usage.measurementId}` } } };
  if (input.type === 'tool-start' && input.tool) return { view, event: { ...common, type: 'tool-start', data: { callId: input.tool.callId ?? common.sourceEventId, name: input.tool.name, ...(input.tool.input === undefined ? {} : { input: input.tool.input }) } } };
  if (input.type === 'tool-end' && input.tool) return { view, event: { ...common, type: 'tool-end', data: { callId: input.tool.callId ?? common.sourceEventId, name: input.tool.name, ...(input.tool.output === undefined ? {} : { output: input.tool.output }), isError: input.tool.isError ?? false } } };
  const state = input.type === 'status' && input.status === 'waiting' ? 'awaiting-input' : input.type === 'completed' || input.type === 'cancelled' || input.type === 'error' ? 'verifying' : view.state === 'cancelling' ? 'cancelling' : 'running';
  const next: BusinessSubtaskV3Dto = { ...view, state, process: 'live', ...(input.error ? { error: { code: input.error.code ?? 'agent_failed', message: input.error.message } } : {}) };
  return { view: next, event: { ...common, type: 'execution-state', data: { state, process: next.process, ...(input.error ? { reason: input.error.code ?? 'agent_failed' } : {}) } } };
}
