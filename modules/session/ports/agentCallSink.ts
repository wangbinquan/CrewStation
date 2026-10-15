// RFC-034 v2 §2/§4 —— session 只声明端口，不存观测数据：收到 Runner 上报的执行快照或 Agent 终态时转交，
// 由组合根装配到 observability 的 Agent 执行记录。写入失败只告警，不影响执行与事件持久化。

import type { AgentUsageSnapshot, TaskId } from '@crewstation/contracts';

/** 一个执行环境（Runner 的任务）里的一个 Agent；同一组合同时最多一次运行中的执行。 */
export interface AgentCallSinkTarget {
  readonly runtimeTaskId: TaskId;
  readonly agentId: string;
}

export interface AgentCallSinkOutcome {
  readonly status: 'done' | 'failed' | 'canceled' | 'interrupted';
  readonly at: Date;
  /** 终态事件带上的最终快照；没有上报时缺省。 */
  readonly snapshot?: AgentUsageSnapshot | null;
}

export interface AgentCallSink {
  usage(target: AgentCallSinkTarget, snapshot: AgentUsageSnapshot): Promise<void>;
  finish(target: AgentCallSinkTarget, outcome: AgentCallSinkOutcome): Promise<void>;
}
