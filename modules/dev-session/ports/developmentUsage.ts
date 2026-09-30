import type { DevelopmentUsageInfo, DevelopmentUsageKey, DevelopmentUsageRegistration, DevelopmentStartIntent, DevelopmentUsageDrainReason, ServiceId, TaskId, TraceId, UsageExecutionIdentity } from '@crewstation/contracts';

export interface DevelopmentPriceInput {
  identity: UsageExecutionIdentity;
  profile: { id: string; revision: number; protocol: 'opencode' | 'claude-code' | 'terminal' } | null;
}
export interface DevelopmentAcceptedPrice extends DevelopmentPriceInput { acceptedAt: string; priceBookRevision: number }
export interface DevelopmentUsagePricing { accept(input: DevelopmentPriceInput): Promise<DevelopmentAcceptedPrice> }
/** Internal owner participant only; never a workbench or business HTTP payload. */
export interface DevelopmentUsagePreparation {
  intent: DevelopmentStartIntent;
  context: { serviceId: ServiceId; traceId: TraceId; branch: string | null };
}
export interface DevelopmentUsagePrepared extends DevelopmentUsagePreparation {
  digestNonce: string;
  payloadDigest: string;
  price: DevelopmentAcceptedPrice;
}
export interface DevelopmentUsageOwnerRecord extends DevelopmentUsagePrepared {
  binding: DevelopmentUsageRegistration | null;
  unsupported: boolean;
  closeReason: DevelopmentUsageDrainReason | null;
}
/** Immutable admissions live apart from AgentStart's ordinary state updates. */
export interface DevelopmentUsageOwnerStore {
  prepare(input: DevelopmentUsagePrepared): Promise<DevelopmentUsageOwnerRecord>;
  get(executionTaskId: TaskId): Promise<DevelopmentUsageOwnerRecord | undefined>;
  bind(executionTaskId: TaskId, binding: DevelopmentUsageRegistration): Promise<DevelopmentUsageOwnerRecord>;
  unsupported(executionTaskId: TaskId): Promise<DevelopmentUsageOwnerRecord>;
  close(executionTaskId: TaskId, reason: DevelopmentUsageDrainReason): Promise<DevelopmentUsageOwnerRecord>;
}
/** Closing this admission is NOT authorization to delete a Pod: Session closure is still required. */
export interface DevelopmentUsageOwner {
  prepare(input: DevelopmentUsagePreparation): Promise<DevelopmentUsageOwnerRecord>;
  get(executionTaskId: TaskId): Promise<DevelopmentUsageOwnerRecord | undefined>;
  bind(executionTaskId: TaskId, info: DevelopmentUsageInfo): Promise<DevelopmentUsageOwnerRecord>;
  unsupported(executionTaskId: TaskId): Promise<DevelopmentUsageOwnerRecord>;
  close(executionTaskId: TaskId, reason: DevelopmentUsageDrainReason): Promise<DevelopmentUsageOwnerRecord>;
  resolve(key: DevelopmentUsageKey): Promise<{ registration: DevelopmentUsageRegistration; price: DevelopmentAcceptedPrice } | undefined>;
}
