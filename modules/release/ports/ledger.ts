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
  /** slot、job：资源中心建的槽与 Job（T8）调和器渲染对象要用的输入。 */
  readonly spec: { readonly children: readonly { readonly kind: string; readonly namespace?: string; readonly name: string }[]; readonly slot?: Readonly<Record<string, unknown>>; readonly job?: Readonly<Record<string, unknown>> };
  readonly display?: Readonly<Record<string, string>>;
  readonly conditions?: readonly { readonly type: string; readonly status: ResourceConditionStatus; readonly reason?: string; readonly message?: string; readonly since?: Date }[];
}

/** 资源中心（RFC-025）的写入口：release 写服务槽与构建、迁移 Job 的期望与领域条件，实况由资源中心写。 */
export interface SlotLedgerWriter {
  declare(input: SlotDeclaration): Promise<SlotRecordRef>;
  find(ref: string, kind: 'service-slot'): Promise<SlotRecordRef | undefined>;
  find(ref: string, kind: 'build-job' | 'migration-job'): Promise<JobRecordRef | undefined>;
  /** 只报领域条件（T8：流水线放弃了一次资源中心建的 Job，报 Failed，调和器随即不再建、删掉凭据）。 */
  report(id: string, report: { readonly conditions: SlotDeclaration['conditions'] }): Promise<unknown>;
}

/** 台账的构建、迁移 Job 记录里 release 关心的部分：期望（有没有 job，即是不是资源中心建的）与只归资源中心的条件（Created、Finished）。 */
export interface JobRecordRef {
  readonly id: string;
  readonly phase: string;
  readonly spec: SlotDeclaration['spec'];
  readonly conditions: readonly { readonly type: string; readonly status: ResourceConditionStatus; readonly reason?: string; readonly message?: string }[];
}

/** 一次发布的构建或迁移 Job（台账记录一条，结果在 Job 被 TTL 删掉之后仍在）。job 是资源中心建它时的渲染输入（T8），子对象随之多一个凭据 Secret。 */
export interface JobProjection {
  readonly kind: 'build-job' | 'migration-job';
  readonly releaseId: string;
  readonly tag: string;
  readonly projectId: ProjectId;
  readonly namespace: string;
  readonly jobName: string;
  readonly job?: Readonly<Record<string, unknown>> & { readonly envSecret: string };
}

/** 由组合根接上 resources 模块：within 加入 release 自己的事务。 */
export interface SlotLedger {
  within(executor: unknown): SlotLedgerWriter;
}
