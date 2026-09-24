import type { ProjectId, ResourceConditionStatus } from '@crewstation/contracts';

/** 台账的服务槽记录里 release 关心的部分（结构上是 resources 模块 LedgerRecord 的子集）。 */
export interface SlotRecordRef {
  readonly id: string;
  /** 期望的版本：spec 一改就加一；资源中心建的槽（T8）观测到的 Deployment 带着渲染它的那一版（appliedGeneration）。 */
  readonly generation: number;
  readonly phase: 'pending' | 'provisioning' | 'starting' | 'ready' | 'degraded' | 'stopping' | 'stopped' | 'failed';
  readonly reason?: { readonly code: string; readonly message: string };
  /** 子对象的观测：Deployment 的期望与就绪副本数（就绪之后的槽 DTO 照它）。 */
  readonly children?: readonly { readonly kind: string; readonly phase: string; readonly replicas?: number; readonly readyReplicas?: number; readonly appliedGeneration?: number }[];
}

export interface SlotDeclaration {
  /** 服务槽，或发布的构建、迁移 Job（第三期）。 */
  readonly kind: 'service-slot' | 'build-job' | 'migration-job';
  readonly ref: string;
  readonly projectId?: ProjectId;
  /** slot：资源中心建的槽（T8）调和器渲染工作负载要用的输入。 */
  readonly spec: { readonly children: readonly { readonly kind: string; readonly namespace?: string; readonly name: string }[]; readonly slot?: Readonly<Record<string, unknown>> };
  readonly display?: Readonly<Record<string, string>>;
  readonly conditions?: readonly { readonly type: string; readonly status: ResourceConditionStatus; readonly reason?: string; readonly message?: string; readonly since?: Date }[];
}

/** 资源中心（RFC-025）的写入口：release 写服务槽与构建、迁移 Job 的期望与领域条件，实况由资源中心写。 */
export interface SlotLedgerWriter {
  declare(input: SlotDeclaration): Promise<SlotRecordRef>;
  find(ref: string, kind: 'service-slot'): Promise<SlotRecordRef | undefined>;
}

/** 一次发布的构建或迁移 Job（台账记录一条，结果在 Job 被 TTL 删掉之后仍在）。 */
export interface JobProjection {
  readonly kind: 'build-job' | 'migration-job';
  readonly releaseId: string;
  readonly tag: string;
  readonly projectId: ProjectId;
  readonly namespace: string;
  readonly jobName: string;
}

/** 由组合根接上 resources 模块：within 加入 release 自己的事务。 */
export interface SlotLedger {
  within(executor: unknown): SlotLedgerWriter;
}
