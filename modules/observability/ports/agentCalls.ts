// RFC-034 v2 §3–§5 —— Agent 执行记录的持久化端口：受理一行、原地替换用量、结束一次；
// 统计全部是对这两张表的窗口过滤 + GROUP BY，没有投影、缓存或触发器。

import type { AgentCallKind, AgentCallSource, AgentCallStatus, AgentCostState, AgentUsageState, ProjectId } from '@crewstation/contracts';
import type { EndedStatus, ModelUsage, UsageBuckets } from '../domain/agentCallUsage';

export interface NewAgentCall {
  readonly id: string;
  /** 档位测试等平台执行不属于项目。 */
  readonly projectId: ProjectId | null;
  readonly source: AgentCallSource;
  readonly kind: AgentCallKind;
  readonly taskId: string;
  readonly taskLabel: string;
  readonly subtaskId: string | null;
  readonly attempt: number | null;
  /** Runner 寻址：执行环境任务与其中的 Agent。 */
  readonly runtimeTaskId: string;
  readonly agentId: string;
  readonly agentKey: string;
  readonly agentLabel: string;
  /** 价格线键：算力档位 ID，或没有档位时的 `builtin:<protocol>`。 */
  readonly profileId: string;
  readonly profileRevision: number | null;
  readonly profileName: string | null;
  readonly protocol: string;
  readonly startedAt: number;
}

/** 一个执行环境里正在运行的那次 Agent 执行。 */
export interface AgentCallTarget {
  readonly runtimeTaskId: string;
  readonly agentId: string;
}

export interface PricedModelUsage extends ModelUsage {
  readonly priceId: string | null;
  readonly costNano: bigint | null;
  readonly costState: AgentCostState;
}

export interface CallEnd {
  readonly status: EndedStatus;
  readonly endedAt: number;
}

/** 一次原地替换的用量，可同时结束执行。 */
export interface CallUsageWrite {
  readonly usageState: AgentUsageState;
  readonly totals: UsageBuckets;
  readonly costNano: bigint;
  readonly costState: AgentCostState;
  readonly models: readonly PricedModelUsage[];
  readonly updatedAt: number;
  readonly end?: CallEnd;
}

export interface CallPricingContext {
  readonly id: string;
  readonly projectId: ProjectId | null;
  readonly profileId: string;
  readonly startedAt: number;
}

/** 统计查询能看到哪些执行：系统看全部，项目只看本项目，平台页只看不属于项目的执行。 */
export type CallScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'project'; readonly projectId: ProjectId }
  | { readonly kind: 'platform' };

export interface CallFilter {
  /** 执行开始时间落在 [from, to)（毫秒）。 */
  readonly from?: number;
  readonly to?: number;
  readonly scope: CallScope;
  readonly source?: AgentCallSource;
}

export type CallGroup = 'none' | 'source' | 'status' | 'day' | 'task' | 'agent' | 'kind' | 'project';

/** 一组的可加合计。人民币为纳元的十进制字符串（全平台合计可能超出安全整数）。 */
export interface CallAggregate {
  readonly key: string | null;
  readonly label: string | null;
  readonly source: AgentCallSource | null;
  readonly projectId: ProjectId | null;
  readonly calls: number;
  readonly incompleteCalls: number;
  readonly failedCalls: number;
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
  readonly reasoning: number;
  readonly costNano: string;
  readonly unpricedCalls: number;
  readonly durationMs: number;
  readonly tasks: number;
  readonly agents: number;
  readonly firstStartedAt: number | null;
  readonly lastEndedAt: number | null;
  readonly running: number;
}

export interface ModelAggregate extends Omit<CallAggregate, 'key' | 'label' | 'source' | 'projectId' | 'durationMs' | 'tasks' | 'agents' | 'firstStartedAt' | 'lastEndedAt' | 'running'> {
  readonly profileId: string;
  readonly profileName: string | null;
  readonly protocol: string;
  readonly model: string;
}

export interface CallRow extends NewAgentCall {
  readonly status: AgentCallStatus;
  readonly endedAt: number | null;
  readonly usageState: AgentUsageState;
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
  readonly reasoning: number;
  readonly costNano: string;
  readonly costState: AgentCostState;
}

export interface CallModelRow extends ModelUsage {
  readonly callId: string;
  readonly costNano: string | null;
  readonly costState: AgentCostState;
}

export interface TaskPageQuery {
  readonly filter: CallFilter;
  readonly q?: string;
  /** 上一页最后一个任务：(首次开始时间, 任务 ID)。 */
  readonly after: { readonly firstStartedAt: number; readonly taskId: string } | null;
  readonly limit: number;
}

export interface AgentCallStore {
  insert(call: NewAgentCall, at: number): Promise<void>;
  /** 一个执行环境中某个 Agent 正在运行的执行（同一组合同时最多一行）。 */
  running(target: AgentCallTarget): Promise<CallPricingContext | null>;
  /** 替换运行中执行的用量；执行已结束时不写并返回 false。 */
  writeUsage(callId: string, write: CallUsageWrite): Promise<boolean>;
  /** 不带快照地结束运行中的执行（pending 用量记为 none）。 */
  end(callId: string, end: CallEnd, at: number): Promise<void>;
  /** 执行环境已不存在：其中仍在运行的执行一并结束，返回条数。 */
  endRuntimeTask(runtimeTaskId: string, end: CallEnd, at: number): Promise<number>;
  aggregate(filter: CallFilter, group: CallGroup, dayOffsetMinutes?: number): Promise<CallAggregate[]>;
  aggregateModels(filter: CallFilter): Promise<ModelAggregate[]>;
  /** 已结束执行的时长分布（毫秒，最近秩）。 */
  durations(filter: CallFilter): Promise<{ readonly samples: number; readonly p50: number | null; readonly p95: number | null; readonly max: number | null }>;
  taskPage(query: TaskPageQuery): Promise<CallAggregate[]>;
  taskCalls(taskId: string, scope: CallScope, limit: number): Promise<{ readonly calls: readonly CallRow[]; readonly models: readonly CallModelRow[]; readonly truncated: boolean }>;
  /** 新到旧，键集翻页在 `before` 之后。 */
  recentCalls(filter: CallFilter, before: { readonly startedAt: number; readonly id: string } | null, limit: number): Promise<{ readonly calls: readonly CallRow[]; readonly models: readonly CallModelRow[] }>;
  /** 每条价格线（档位 × 实际模型）出现过的执行数，供价格目录列出。 */
  profileModels(): Promise<readonly { readonly profileId: string; readonly model: string; readonly calls: number }[]>;
}
