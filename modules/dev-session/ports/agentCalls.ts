import type { ProjectId, TaskId } from '@crewstation/contracts';

/** 开发会话里的一次 Agent 执行：headless Agent，或「＋ CLI」终端。 */
export interface DevelopmentCall {
  readonly kind: 'agent' | 'cli';
  readonly projectId: ProjectId;
  /** 所属开发会话（工作区任务）与它受理时的展示名。 */
  readonly sessionId: TaskId;
  readonly sessionLabel: string;
  /** Runner 寻址：执行环境任务与其中的 Agent。 */
  readonly runtimeTaskId: TaskId;
  readonly agentId: string;
  readonly profile: { readonly id: string; readonly revision: number; readonly name: string | null };
  readonly protocol: string;
}

/**
 * RFC-034 v2 §4：开发执行在派发前受理一条执行记录（组合根接到 observability）；用量与 Runner 上报的终态由
 * Session 转交，执行环境结束的兜底由 observability 订阅环境释放事件完成。
 */
export interface DevelopmentCalls {
  /** 失败时不派发；同一执行重复受理是幂等的。 */
  accept(call: DevelopmentCall): Promise<void>;
  /** owner 判定的结束（派发被定性拒绝）：Runner 不会再上报这次执行。 */
  fail(target: { readonly runtimeTaskId: TaskId; readonly agentId: string }): Promise<void>;
}
