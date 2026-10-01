import type { DevelopmentUsageClosure, DevelopmentUsageDrainReason, DevelopmentUsageRegistration, DevelopmentUsageStopReceipt, DevelopmentUsageIdentity } from '@crewstation/contracts';

/** Owner-private immutable selection; this is never a business or workbench HTTP payload. */
export interface DevelopmentCleanupSelection {
  readonly version: 1;
  readonly identity: DevelopmentUsageIdentity & { readonly sourceKind: 'development-agent'; readonly executionGeneration: 1 };
  readonly profileId: string;
  readonly profileRevision: number;
  readonly podUid: string;
  readonly consumerId: string;
  readonly renderStart: number;
  readonly selectionHash: string;
}
export interface DevelopmentCleanupEvidence {
  readonly version: 1;
  readonly selection: DevelopmentCleanupSelection;
  readonly registration: DevelopmentUsageRegistration;
  readonly stop: DevelopmentUsageStopReceipt;
  readonly closure: DevelopmentUsageClosure;
  readonly owner: {
    readonly payloadDigest: string;
    readonly firstReason: DevelopmentUsageDrainReason;
    readonly acceptedAt: string;
    readonly profileId: string;
    readonly profileRevision: number;
    readonly protocol: 'opencode' | 'claude-code';
    readonly priceBookRevision: number;
  };
}
export type DevelopmentCleanupResult = { readonly kind: 'waiting'; readonly reason: string } | { readonly kind: 'permitted'; readonly evidence: DevelopmentCleanupEvidence };
export interface DevelopmentCleanupParticipant { advance(input: DevelopmentCleanupSelection): Promise<DevelopmentCleanupResult> }
