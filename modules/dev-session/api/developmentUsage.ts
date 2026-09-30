import type { DevelopmentUsageInfo, DevelopmentUsageKey, DevelopmentUsageRegistration, DevelopmentStartIntent, DevelopmentUsageDrainReason, ServiceId, TaskId, TraceId, UsageExecutionIdentity } from '@crewstation/contracts';

export interface DevelopmentPriceInput {
  identity: UsageExecutionIdentity;
  profile: { id: string; revision: number; protocol: 'opencode' | 'claude-code' | 'terminal' } | null;
}
export interface DevelopmentAcceptedPrice extends DevelopmentPriceInput { acceptedAt: string; priceBookRevision: number }
export interface DevelopmentUsagePricing { accept(input: DevelopmentPriceInput): Promise<DevelopmentAcceptedPrice> }
/** Independent internal API values; never a workbench or business HTTP payload. */
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
  /** Once observed, capability cannot disappear into a legacy fallback; bound to the actual original Pod. */
  capabilityPodUid?: string;
}
/** Frozen non-sensitive source choice; consumer still verifies independent Session registration. */
export interface DevelopmentUsageResolved {
  registration: DevelopmentUsageRegistration;
  price: DevelopmentAcceptedPrice;
  nativeSelection?: { version: 1; expectedNamespace: string };
}
/** Closing this admission is NOT authorization to delete a Pod: Session closure is still required. */
export interface DevelopmentUsageOwner {
  prepare(input: DevelopmentUsagePreparation): Promise<DevelopmentUsageOwnerRecord>;
  get(executionTaskId: TaskId): Promise<DevelopmentUsageOwnerRecord | undefined>;
  bind(executionTaskId: TaskId, info: DevelopmentUsageInfo): Promise<DevelopmentUsageOwnerRecord>;
  observeSupported(executionTaskId: TaskId): Promise<DevelopmentUsageOwnerRecord>;
  unsupported(executionTaskId: TaskId): Promise<DevelopmentUsageOwnerRecord>;
  close(executionTaskId: TaskId, reason: DevelopmentUsageDrainReason): Promise<DevelopmentUsageOwnerRecord>;
  resolve(key: DevelopmentUsageKey): Promise<DevelopmentUsageResolved | undefined>;
}
