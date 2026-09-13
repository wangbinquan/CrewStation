import type { RunnerCommand, RunnerEvent, TaskId } from '@crewstation/contracts';
import { PlatformError } from '@crewstation/kernel';

export interface StoredEvent { seq: number; at: string; event: RunnerEvent }
export interface ConnectionStatus { connected: boolean; replica?: string; lastSeq?: number; drivers?: string[] }

/** 与 cs-session 的 internal 路由一一对应；只在系统命名空间内调用。 */
export interface SessionClient {
  sendCommand(taskId: TaskId, command: RunnerCommand): Promise<unknown>;
  listEvents(taskId: TaskId, options?: { sinceSeq?: number; kinds?: RunnerEvent['kind'][]; agentId?: string; limit?: number }): Promise<StoredEvent[]>;
  connectionStatus(taskId: TaskId): Promise<ConnectionStatus>;
}

export function createSessionClient(baseUrl: string, fetchImpl: typeof fetch = fetch): SessionClient {
  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetchImpl(`${baseUrl}${path}`, init);
    const body = (await res.json().catch(() => ({}))) as T & { error?: PlatformError['kind']; message?: string; details?: Record<string, unknown> };
    if (!res.ok) throw new PlatformError(body.error ?? 'unavailable', body.message ?? `cs-session 返回 ${res.status}`, body.details);
    return body;
  };
  return {
    sendCommand: async (taskId, command) => (await call<{ payload: unknown }>(`/internal/tasks/${taskId}/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) })).payload,
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
