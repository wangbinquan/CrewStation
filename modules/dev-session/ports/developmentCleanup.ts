import type { DevelopmentUsageKey, DevelopmentUsageLookup, WorkloadConsumer, WorkloadStopProof, WorkloadStartPermit, StoredDevelopmentUsage, TaskId } from '@crewstation/contracts';
import type { DevelopmentCleanupEvidence, DevelopmentCleanupSelection } from '../domain/development/cleanup';
import type { DevelopmentEndingDeps, DevelopmentEndingSession } from './developmentEnding';
import type { Environments } from './runtime';

export interface DevelopmentCleanupSession extends DevelopmentEndingSession {
  lookupDevelopmentUsage?(taskId: TaskId): Promise<DevelopmentUsageLookup>;
  getDevelopmentUsage(taskId: TaskId, key: DevelopmentUsageKey): Promise<StoredDevelopmentUsage | undefined>;
}
export interface DevelopmentCleanupWorkloadSafety {
  get(id: string): Promise<{ consumer: WorkloadConsumer; admissionClosed: boolean; startPermit: WorkloadStartPermit | null; stopProof: WorkloadStopProof | null } | undefined>;
  admissionClosed(id: string): Promise<boolean>;
}
export interface DevelopmentCleanupDeps extends Omit<DevelopmentEndingDeps, 'session'> {
  session: DevelopmentCleanupSession;
  workloadSafety?: DevelopmentCleanupWorkloadSafety;
  environments: Pick<Environments, 'getEnvironment'>;
  /** Deletion-only closure of this already-verified original admission, not a physical stop assertion. */
  closeOriginalAdmission?(id: TaskId): Promise<void>;
}
export interface DevelopmentCleanupParticipant {
  completePrestart?(input: DevelopmentCleanupSelection): ReturnType<DevelopmentCleanupParticipant['advance']>;
  advance(input: DevelopmentCleanupSelection): Promise<{ readonly kind: 'waiting'; readonly reason: string } | { readonly kind: 'permitted'; readonly evidence: DevelopmentCleanupEvidence }>;
}
