import type { AgentActivityPage, AgentActivityQuery, ReadAgentActivityRequest, RunnerEvent, TaskId, UserId } from '@crewstation/contracts';

export interface StoredNativeEvent { seq: number; at: string; event: RunnerEvent }
export type NativeActivityRead = Pick<AgentActivityPage, 'items' | 'states' | 'unread' | 'nextCursor' | 'hasMore' | 'previousCursor' | 'throughSeq' | 'historyTruncated'>;

export interface NativeActivityRepository {
  cursor(taskId: TaskId, sourceTaskId?: TaskId): Promise<number>;
  /** 同任务写事务串行且等待有界（超时以 precondition 失败），跳过其他实例已经处理的序号；不能跳过未读取的源区间。 */
  apply(taskId: TaskId, sinceSeq: number, events: StoredNativeEvent[], sourceTaskId?: TaskId): Promise<number>;
  completedSources(taskId: TaskId): Promise<TaskId[]>;
  completeSource(taskId: TaskId, sourceTaskId: TaskId): Promise<void>;
  /** 只读快照，不等待写锁：另一事务持锁时读取仍立即返回。 */
  read(taskId: TaskId, userId: UserId, query: AgentActivityQuery): Promise<NativeActivityRead>;
  markRead(taskId: TaskId, userId: UserId, input: ReadAgentActivityRequest): Promise<number>;
}
