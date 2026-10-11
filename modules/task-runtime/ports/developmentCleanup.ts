import type { WorkloadConsumer, WorkloadStartPermit, WorkloadStopProof } from '@crewstation/contracts';
import type { DevelopmentCleanupEvidence, DevelopmentCleanupSelection } from '../domain/development/cleanupEvidence';

export interface DevelopmentCleanupParticipant {
  completePrestart?(input: DevelopmentCleanupSelection): ReturnType<DevelopmentCleanupParticipant['advance']>;
  advance(input: DevelopmentCleanupSelection): Promise<{ readonly kind: 'waiting'; readonly reason: string } | { readonly kind: 'permitted'; readonly evidence: DevelopmentCleanupEvidence }>;
}
export interface DevelopmentPhysicalStopEvidence {
  readonly consumer: WorkloadConsumer;
  readonly startPermit: WorkloadStartPermit | null;
  readonly stopProof: WorkloadStopProof;
  readonly admissionSecretUid?: string;
}
/** Every destructive step rechecks the durable Task job; I/O stays outside its transaction. */
export interface DevelopmentCleanupGuard {
  current(): Promise<void>;
  /** Independently closes the no-grant owner after real stop proof, before the first credential deletion. */
  beforeCredentials?(): Promise<void>;
  /** Only on the new selection; obtained from the original durable Resources receipt outside Task locks. */
  admissionSecretUid?(): Promise<string>;
  stopped(): Promise<DevelopmentPhysicalStopEvidence>;
}
