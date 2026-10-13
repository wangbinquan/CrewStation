import type { DevelopmentUsageInfo, DevelopmentUsageKey, DevelopmentUsageRegistration, DevelopmentStartIntent, DevelopmentUsageDrainReason, ServiceId, TaskId, TraceId, UsageExecutionIdentity, RunnerHello } from '@crewstation/contracts';

export interface DevelopmentPriceInput {
  identity: UsageExecutionIdentity;
  profile: { id: string; revision: number; protocol: 'opencode' | 'claude-code' | 'terminal' } | null;
}
export interface DevelopmentAcceptedPrice extends DevelopmentPriceInput { acceptedAt: string; priceBookRevision: number }
export interface DevelopmentUsagePricing { accept(input: DevelopmentPriceInput): Promise<DevelopmentAcceptedPrice> }
/** Internal owner participant only; never a workbench or business HTTP payload. */
export interface DevelopmentUsagePreparation {
  intent: DevelopmentStartIntent;
  /** Only automatic new admissions may preserve an independently unsupported legacy Runner. */
  legacyFallbackAllowed?: boolean;
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
  unsupportedProof?: {version:1; podUid:string; capabilities:RunnerHello['capabilities']};
  closeReason: DevelopmentUsageDrainReason | null;
  /** Numeric or selected-layout fence capability forbids legacy fallback; bound to the original Pod, not proof of a healthy journal. */
  capabilityPodUid?: string;
}
/** Immutable admissions live apart from AgentStart's ordinary state updates. */
export interface DevelopmentUsageOwnerStore {
  prepare(input: DevelopmentUsagePrepared): Promise<DevelopmentUsageOwnerRecord>;
  get(executionTaskId: TaskId): Promise<DevelopmentUsageOwnerRecord | undefined>;
  bind(executionTaskId: TaskId, binding: DevelopmentUsageRegistration): Promise<DevelopmentUsageOwnerRecord>;
  observeSupported(executionTaskId: TaskId, podUid: string): Promise<DevelopmentUsageOwnerRecord>;
  unsupported(executionTaskId: TaskId, proof?:DevelopmentUsageOwnerRecord['unsupportedProof']): Promise<DevelopmentUsageOwnerRecord>;
  close(executionTaskId: TaskId, reason: DevelopmentUsageDrainReason): Promise<DevelopmentUsageOwnerRecord>;
}
/** Frozen non-sensitive source choice; consumer still verifies independent Session registration. */
export interface DevelopmentUsageResolved {
  registration: DevelopmentUsageRegistration;
  price: DevelopmentAcceptedPrice;
  nativeSelection?: { version: 1 | 2; expectedNamespace: string };
}
/** Closing this admission is NOT authorization to delete a Pod: Session closure is still required. */
export interface DevelopmentUsageOwner {
  prepare(input: DevelopmentUsagePreparation): Promise<DevelopmentUsageOwnerRecord>;
  get(executionTaskId: TaskId): Promise<DevelopmentUsageOwnerRecord | undefined>;
  bind(executionTaskId: TaskId, info: DevelopmentUsageInfo): Promise<DevelopmentUsageOwnerRecord>;
  observeSupported(executionTaskId: TaskId): Promise<DevelopmentUsageOwnerRecord>;
  unsupported(executionTaskId: TaskId, capabilities?:RunnerHello['capabilities']): Promise<DevelopmentUsageOwnerRecord>;
  close(executionTaskId: TaskId, reason: DevelopmentUsageDrainReason): Promise<DevelopmentUsageOwnerRecord>;
  resolve(key: DevelopmentUsageKey): Promise<DevelopmentUsageResolved | undefined>;
}
