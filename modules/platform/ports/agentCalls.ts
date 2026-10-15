// RFC-034 v2 §4 —— 组合根把各 owner 的受理端口与 Session 的转交端口接到 Agent 执行记录器时依赖的形状；
// 记录器由 observability 提供（late 绑定，未装配时为 undefined）。
import type { AgentCallKind, AgentCallSource, AgentCallStatus, AgentUsageSnapshot, ProjectId } from '@crewstation/contracts';

export interface AgentCallTargetRef {
  readonly runtimeTaskId: string;
  readonly agentId: string;
}

/** 派发前受理的执行身份；`id` 由 owner 的业务尝试稳定推导，重复受理幂等。 */
export interface AgentCallAdmission extends AgentCallTargetRef {
  readonly id: string;
  readonly projectId: ProjectId | null;
  readonly source: AgentCallSource;
  readonly kind: AgentCallKind;
  readonly taskId: string;
  readonly taskLabel: string;
  readonly subtaskId: string | null;
  readonly attempt: number | null;
  readonly agentKey: string;
  readonly agentLabel: string;
  readonly profile: { readonly id: string; readonly revision: number; readonly name: string | null } | null;
  readonly protocol: string;
}

export interface AgentCallEnding {
  readonly status: Exclude<AgentCallStatus, 'running'>;
  readonly at: Date;
  readonly snapshot?: AgentUsageSnapshot | null;
}

export interface AgentCallRecorderPort {
  accept(start: AgentCallAdmission): Promise<string>;
  usage(target: AgentCallTargetRef, snapshot: AgentUsageSnapshot): Promise<void>;
  finish(target: AgentCallTargetRef, outcome: AgentCallEnding): Promise<void>;
  closeRuntimeTask(runtimeTaskId: string, at: Date): Promise<number>;
}

/** observability 晚于 owner 装配：取当前记录器，未装配时为 undefined。 */
export type AgentCallRecorderSource = () => AgentCallRecorderPort | undefined;
