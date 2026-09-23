import type { RunnerCommand, RunnerEvent, RunnerHello, TaskId } from '@crewstation/contracts';

export interface StoredEventDto { seq: number; at: string; event: RunnerEvent }

/** session 模块对外能力（本进程内）；跨进程调用走 internal HTTP，客户端在 packages/session-client。 */
export interface SessionModuleApi {
  readonly name: 'session';
  sendCommand(taskId: TaskId, command: RunnerCommand): Promise<unknown>;
  listEvents(taskId: TaskId, options: { sinceSeq?: number; kinds?: RunnerEvent['kind'][]; agentId?: string; limit?: number }): Promise<StoredEventDto[]>;
  /** 按任务汇总事件（调用链回放，Design §14）：指定种类的条数，以及出现过的原生会话 ID 与 Agent 协议；没有事件的任务不返回。 */
  summarizeEvents(taskIds: readonly TaskId[], kinds: RunnerEvent['kind'][]): Promise<Array<{ taskId: TaskId; events: number; sessionIds: string[]; protocol?: string }>>;
  connectionStatus(taskId: TaskId): Promise<{ connected: boolean; replica?: string; lastSeq?: number; protocols?: string[]; capabilities?: RunnerHello['capabilities'] }>;
}
