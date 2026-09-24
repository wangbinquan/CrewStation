import type { ClusterPurpose, ProjectId, ResourceConditionStatus, ResourceKind, StartupRecord } from '@crewstation/contracts';

/** 台账里 task-runtime 关心的部分（结构上是 resources 模块 LedgerRecord 的子集）。 */
export interface LedgerRecordRef {
  readonly id: string;
  readonly desired: 'present' | 'absent';
  readonly owner: { readonly module: string; readonly ref: string };
  readonly conditions: readonly { readonly type: string; readonly status: ResourceConditionStatus }[];
  /** 期望「不要了」的原因；资源中心替所属模块改期望只有一种：失败保留期满（retention-expired）。 */
  readonly releaseReason?: { readonly code: string; readonly message: string };
}

export interface LedgerConditionUpdate {
  readonly type: string;
  readonly status: ResourceConditionStatus;
  readonly reason?: string;
  readonly message?: string;
  /** 发生时刻；台账只会把已记的起点往早改。 */
  readonly since?: Date;
}

export interface LedgerDeclaration {
  readonly id?: string;
  readonly kind: ResourceKind;
  readonly ref: string;
  readonly projectId?: ProjectId;
  readonly parentId?: string;
  readonly purpose?: ClusterPurpose;
  /** 子对象、工作卷的回收方式，以及资源中心建出子对象要用的期望（RFC-025 I25，不含凭据）。 */
  readonly spec: { readonly children: readonly { readonly kind: string; readonly namespace?: string; readonly name: string }[]; readonly reclaim?: 'delete' | 'retain'; readonly [field: string]: unknown };
  readonly display?: Readonly<Record<string, string>>;
  readonly conditions?: readonly LedgerConditionUpdate[];
  /** 旧身份（RFC-013 之前的 `tsk_…`）：台账按它也能找回记录。 */
  readonly aliases?: readonly { readonly source: 'tsk'; readonly alias: string }[];
}

/** 资源中心（RFC-025）的写入口：task-runtime 写期望与领域条件，实况由资源中心写。 */
export interface LedgerWriter {
  declare(input: LedgerDeclaration): Promise<LedgerRecordRef>;
  /** 受理：占额度的种类在项目锁下按台账数额度，够才声明，不够抛 quota_exceeded（设计 §3、D31）。 */
  admit(input: LedgerDeclaration): Promise<LedgerRecordRef>;
  requestRelease(id: string, reason: { readonly code: string; readonly message: string }): Promise<LedgerRecordRef>;
  report(id: string, report: { readonly conditions?: readonly LedgerConditionUpdate[]; readonly startup?: StartupRecord | null; readonly display?: Readonly<Record<string, string>> }): Promise<LedgerRecordRef>;
  find(ref: string, kind: ResourceKind): Promise<LedgerRecordRef | undefined>;
}

/** 由组合根接上 resources 模块：within 加入 task-runtime 自己的事务；live 列出它名下还在的记录（补投影用）；occupancy 是项目眼下占用的额度单位。 */
export interface EnvironmentLedger {
  within(executor: unknown): LedgerWriter;
  live(): Promise<readonly LedgerRecordRef[]>;
  occupancy(projectId: ProjectId): Promise<number>;
}
