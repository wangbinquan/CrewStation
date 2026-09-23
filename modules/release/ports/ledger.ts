import type { ProjectId, ResourceConditionStatus } from '@crewstation/contracts';

/** 台账的服务槽记录里 release 关心的部分（结构上是 resources 模块 LedgerRecord 的子集）。 */
export interface SlotRecordRef {
  readonly id: string;
  readonly phase: 'pending' | 'provisioning' | 'starting' | 'ready' | 'degraded' | 'stopping' | 'stopped' | 'failed';
  readonly reason?: { readonly code: string; readonly message: string };
}

export interface SlotDeclaration {
  readonly kind: 'service-slot';
  readonly ref: string;
  readonly projectId?: ProjectId;
  readonly spec: { readonly children: readonly { readonly kind: string; readonly namespace?: string; readonly name: string }[] };
  readonly display?: Readonly<Record<string, string>>;
  readonly conditions?: readonly { readonly type: string; readonly status: ResourceConditionStatus; readonly reason?: string; readonly message?: string; readonly since?: Date }[];
}

/** 资源中心（RFC-025）的写入口：release 写服务槽的期望与领域条件，实况由资源中心写。 */
export interface SlotLedgerWriter {
  declare(input: SlotDeclaration): Promise<SlotRecordRef>;
  find(ref: string, kind: 'service-slot'): Promise<SlotRecordRef | undefined>;
}

/** 由组合根接上 resources 模块：within 加入 release 自己的事务。 */
export interface SlotLedger {
  within(executor: unknown): SlotLedgerWriter;
}
