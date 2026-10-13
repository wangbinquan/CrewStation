import type { RunnerHello, WorkloadStartPermit } from '@crewstation/contracts';
import type { DevelopmentUsageClosure, DevelopmentUsageDrainReason, DevelopmentUsageRegistration, DevelopmentUsageStopReceipt, DevelopmentUsageIdentity, WorkloadConsumer, WorkloadStopProof, TaskId } from '@crewstation/contracts';

/** Owner-private immutable selection; this is never a business or workbench HTTP payload. */
export interface DevelopmentCleanupSelection {
  readonly version: 1;
  readonly identity: DevelopmentUsageIdentity & { readonly sourceKind: 'development-agent'|'development-cli'; readonly executionGeneration: 1 };
  readonly profileId: string;
  readonly profileRevision: number;
  readonly podUid: string;
  readonly consumerId: string;
  readonly renderStart: number;
  readonly selectionHash: string;
}
export interface DevelopmentBoundCleanupEvidence {
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
export interface DevelopmentPrestartCleanupEvidence {
  readonly version: 2;
  readonly kind: 'unbound-no-grant';
  readonly phase: 'stopping' | 'closed';
  readonly numericState: 'unknown';
  readonly selection: DevelopmentCleanupSelection;
  readonly owner: DevelopmentBoundCleanupEvidence['owner'];
  readonly consumer: WorkloadConsumer;
  readonly stopProof: WorkloadStopProof | null;
  readonly stopProofDigest: string | null;
}
export interface DevelopmentUnsupportedCliEvidence { readonly version:3;readonly kind:'unsupported-cli';readonly phase:'stopping'|'closed';readonly numericState:'unknown';readonly selection:DevelopmentCleanupSelection;readonly owner:DevelopmentBoundCleanupEvidence['owner'];readonly capability:{version:1;podUid:string;capabilities:RunnerHello['capabilities']};readonly consumer:WorkloadConsumer;readonly startPermit:WorkloadStartPermit;readonly stopProof:WorkloadStopProof|null;readonly stopProofDigest:string|null; }
export type DevelopmentCleanupEvidence = DevelopmentBoundCleanupEvidence | DevelopmentPrestartCleanupEvidence | DevelopmentUnsupportedCliEvidence;
export type DevelopmentCleanupResult = { readonly kind: 'waiting'; readonly reason: string } | { readonly kind: 'permitted'; readonly evidence: DevelopmentCleanupEvidence };
export interface DevelopmentCleanupParticipant {
  advance(input: DevelopmentCleanupSelection): Promise<DevelopmentCleanupResult>;
  completePrestart?(input: DevelopmentCleanupSelection): Promise<DevelopmentCleanupResult>;
}

export interface DevelopmentCleanupQuery {
  inspectDevelopmentCleanupSelection?(taskId: TaskId): Promise<DevelopmentCleanupSelection | undefined>;
}
