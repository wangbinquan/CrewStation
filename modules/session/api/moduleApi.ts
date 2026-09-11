import type { RunnerCommand, RunnerEvent, TaskId } from '@crewstation/contracts';

export interface StoredEventDto { seq: number; at: string; event: RunnerEvent }

/** session 模块对外能力（本进程内）；跨进程调用走 internal HTTP，客户端在 packages/session-client。 */
export interface SessionModuleApi {
  readonly name: 'session';
  sendCommand(taskId: TaskId, command: RunnerCommand): Promise<unknown>;
  listEvents(taskId: TaskId, options: { sinceSeq?: number; kinds?: RunnerEvent['kind'][]; agentId?: string; limit?: number }): Promise<StoredEventDto[]>;
  connectionStatus(taskId: TaskId): Promise<{ connected: boolean; replica?: string; lastSeq?: number; drivers?: string[] }>;
}
