import type { ExecutionCompletionProof, RunnerBusinessEvent, StoredBusinessExecutionDto, RunnerCommand, RunnerEvent, RunnerHello, TaskId } from '@crewstation/contracts';
import { ExecutionCompletionProofSchema, StoredBusinessExecutionSchema, RunnerResultPayloads } from '@crewstation/contracts';
import { API_INVOCATION_TIMEOUT_MS, COMPARISON_COMMAND_TIMEOUT_MS, COMPARISON_HISTORY_TIMEOUT_MS, WORKSPACE_COMMAND_TIMEOUT_MS } from '@crewstation/contracts';
import { PlatformError } from '@crewstation/kernel';

export interface StoredEvent { seq: number; at: string; event: RunnerEvent }
export interface ConnectionStatus { connected: boolean; replica?: string; lastSeq?: number; protocols?: string[]; capabilities?: RunnerHello['capabilities'] }

/** 与 cs-session 的 internal 路由一一对应；只在系统命名空间内调用。 */
export interface SessionClient {
  getExecutionCompletionProof(taskId: TaskId, executionId: string): Promise<ExecutionCompletionProof>;
  consumeBusinessExecution(taskId: TaskId, executionId: string, through: number, stopped?: boolean): Promise<void>;
  getBusinessExecution(taskId: TaskId, executionId: string): Promise<StoredBusinessExecutionDto>;
  listBusinessExecutionEvents(taskId: TaskId, executionId: string, after?: number, limit?: number): Promise<RunnerBusinessEvent[]>;
  sendCommand(taskId: TaskId, command: RunnerCommand): Promise<unknown>;
  listEvents(taskId: TaskId, options?: { sinceSeq?: number; kinds?: RunnerEvent['kind'][]; agentId?: string; limit?: number }): Promise<StoredEvent[]>;
  connectionStatus(taskId: TaskId): Promise<ConnectionStatus>;
}

export function createSessionClient(baseUrl: string, fetchImpl: typeof fetch = fetch): SessionClient {
  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetchImpl(new URL(`${baseUrl}${path}`), { keepalive: false, redirect: 'error', signal: AbortSignal.timeout(30_000), ...init });
    const body = (await res.json().catch(() => ({}))) as T & { error?: PlatformError['kind']; message?: string; details?: Record<string, unknown> };
    if (!res.ok) throw new PlatformError(body.error ?? 'unavailable', body.message ?? `cs-session 返回 ${res.status}`, body.details);
    return body;
  };
  return {
    getExecutionCompletionProof: async (taskId, executionId) => ExecutionCompletionProofSchema.parse(await call(`/internal/tasks/${taskId}/executions/${encodeURIComponent(executionId)}/completion-proof`)),
    consumeBusinessExecution: async (taskId, executionId, through, stopped) => { await call(`/internal/tasks/${taskId}/executions/${encodeURIComponent(executionId)}/consumed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ through, stopped }) }); },
    getBusinessExecution: async (taskId, executionId) => StoredBusinessExecutionSchema.parse(await call(`/internal/tasks/${taskId}/executions/${encodeURIComponent(executionId)}`)),
    listBusinessExecutionEvents: async (taskId, executionId, after = 0, limit = 200) => RunnerResultPayloads.businessExecutionEvents.parse((await call<{ items: unknown }>(`/internal/tasks/${taskId}/executions/${encodeURIComponent(executionId)}/events?${new URLSearchParams({ after: String(after), limit: String(limit) })}`)).items),
    sendCommand: async (taskId, command) => (await call<{ payload: unknown }>(`/internal/tasks/${taskId}/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(commandBudget(command) + 15_000) })).payload,
    listEvents: async (taskId, options = {}) => {
      const params = new URLSearchParams();
      if (options.sinceSeq !== undefined) params.set('sinceSeq', String(options.sinceSeq));
      if (options.kinds?.length) params.set('kinds', options.kinds.join(','));
      if (options.agentId) params.set('agentId', options.agentId);
      if (options.limit) params.set('limit', String(options.limit));
      return (await call<{ items: StoredEvent[] }>(`/internal/tasks/${taskId}/events?${params}`)).items;
    },
    connectionStatus: (taskId) => call(`/internal/tasks/${taskId}/connection`),
  };
}

function commandBudget(command: RunnerCommand): number {
  if (command.type === 'invokeApi') return API_INVOCATION_TIMEOUT_MS;
  if (command.type === 'fetchComparisonHistory') return COMPARISON_HISTORY_TIMEOUT_MS;
  if (command.type === 'compareWorkspace' || command.type === 'workspaceComparisonDetails') return COMPARISON_COMMAND_TIMEOUT_MS;
  return WORKSPACE_COMMAND_TIMEOUT_MS;
}
