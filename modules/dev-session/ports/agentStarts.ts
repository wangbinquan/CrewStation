import type { AgentPermission, ProfileRevisionRef, TaskId, UserId } from '@crewstation/contracts';

/**
 * 一个 headless Agent 的受理记录（RFC-006 §5：每个 Agent 一个 Pod）。受理时固定档位修订与执行环境身份；
 * 派发、结束判定与回收由后台按记录接续，控制器重启或回执丢失都不重复起进程。
 */
export interface AgentStart {
  readonly agentId: string;
  /** 父开发会话。 */
  readonly taskId: TaskId;
  readonly createdBy: UserId;
  /** 解析后的算力档位 UUID。 */
  readonly compute: string;
  readonly computeName?: string;
  readonly profile: ProfileRevisionRef;
  readonly permission: AgentPermission;
  readonly request: { readonly prompt: string; readonly cwd?: string; readonly resumeSessionId?: string };
  readonly execution: { readonly previousTaskId?: TaskId; readonly taskId: TaskId; readonly runnerId: string; readonly taskProfile?: string; readonly image: string };
  /** pending：等执行环境就绪后派发；dispatched：startAgent 已被 Runner 受理；ended：已结束（含受理失败与未启动即取消）。 */
  readonly state: 'pending' | 'dispatched' | 'ended';
  readonly failure?: string;
  readonly cancelled?: boolean;
  /** 已读到的子 Runner 事件序号：结束判定只看新事件。 */
  readonly cursor: number;
  /** 执行环境已交给 task-runtime 回收，后台不再处理。 */
  readonly finalized: boolean;
  readonly createdAt: string;
  readonly dispatchedAt?: string;
  readonly endedAt?: string;
}

export interface AgentStartRepository {
  reserveRestart(operationId: string): Promise<{ agentId: string; taskId: TaskId }>;
  insert(start: AgentStart): Promise<void>;
  get(agentId: string): Promise<AgentStart | undefined>;
  findByExecution(executionTaskId: TaskId): Promise<AgentStart | undefined>;
  listByTask(taskId: TaskId): Promise<AgentStart[]>;
  listUnfinalized(after: string | undefined, limit: number): Promise<AgentStart[]>;
  update(start: AgentStart): Promise<void>;
  /** 同一 Agent 的派发与回收跨实例串行。 */
  withLock(agentId: string, operation: () => Promise<void>): Promise<void>;
}
