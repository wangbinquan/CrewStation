// RFC-034 v2 §4 —— Agent 执行记录的写入口（模块对外形状）：owner 派发前受理一行，Session 转交用量快照与终态，
// owner 判定的结束与执行环境释放兜底补写终态。实现见 application/agentCallRecorder.ts。
import type { AgentCallKind, AgentCallSource, AgentCallStatus, AgentUsageSnapshot, ProjectId } from '@crewstation/contracts';

/** 一个执行环境里正在运行的那次 Agent 执行。 */
export interface AgentCallTarget {
  readonly runtimeTaskId: string;
  readonly agentId: string;
}

/** 受理时固定的执行身份（owner 提供，派发前持久化）。 */
export interface AgentCallStart extends AgentCallTarget {
  /** owner 自己稳定的执行 ID（UUID）；重复受理同一 ID 是幂等的。缺省新生成。 */
  readonly id?: string;
  /** 档位测试等平台执行不属于项目。 */
  readonly projectId: ProjectId | null;
  readonly source: AgentCallSource;
  readonly kind: AgentCallKind;
  readonly taskId: string;
  readonly taskLabel: string;
  readonly subtaskId: string | null;
  readonly attempt: number | null;
  readonly agentKey: string;
  readonly agentLabel: string;
  /** 受理时固定的算力档位；没有档位的平台执行用协议内置价格线。 */
  readonly profile: { readonly id: string; readonly revision: number; readonly name: string | null } | null;
  readonly protocol: string;
  readonly startedAt?: Date;
}

export interface AgentCallOutcome {
  readonly status: Exclude<AgentCallStatus, 'running'>;
  readonly at: Date;
  /** 最终快照；运行时没有上报时缺省。 */
  readonly snapshot?: AgentUsageSnapshot | null;
}

export interface AgentCallRecorder {
  /** 必须在派发前成功；失败时调用方不得派发（不留无记录的执行）。返回执行行 ID。 */
  accept(start: AgentCallStart): Promise<string>;
  /** 替换运行中执行的用量快照。 */
  usage(target: AgentCallTarget, snapshot: AgentUsageSnapshot): Promise<void>;
  /** 写终态与最终快照；执行已结束时不再改变（幂等）。 */
  finish(target: AgentCallTarget, outcome: AgentCallOutcome): Promise<void>;
  /** 执行环境已不存在：其中仍在运行的执行记为中断。 */
  closeRuntimeTask(runtimeTaskId: string, at: Date): Promise<number>;
}
