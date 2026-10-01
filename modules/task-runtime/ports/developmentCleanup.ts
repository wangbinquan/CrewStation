import type { WorkloadConsumer, WorkloadStartPermit, WorkloadStopProof } from '@crewstation/contracts';
import type { DevelopmentCleanupEvidence, DevelopmentCleanupSelection } from '../domain/development/cleanupEvidence';

export interface DevelopmentCleanupParticipant {
  advance(input: DevelopmentCleanupSelection): Promise<{ readonly kind: 'waiting'; readonly reason: string } | { readonly kind: 'permitted'; readonly evidence: DevelopmentCleanupEvidence }>;
}
export interface DevelopmentPhysicalStopEvidence {
  readonly consumer: WorkloadConsumer;
  readonly startPermit: WorkloadStartPermit;
  readonly stopProof: WorkloadStopProof;
  readonly admissionSecretUid?: string;
}
/** Every destructive step rechecks the durable Task job; I/O stays outside its transaction. */
export interface DevelopmentCleanupGuard {
  current(): Promise<void>;
  /** Only on the new selection; obtained from the original durable Resources receipt outside Task locks. */
  admissionSecretUid?(): Promise<string>;
  stopped(): Promise<DevelopmentPhysicalStopEvidence>;
}
