import type { DevelopmentUsageKey, StoredDevelopmentUsage, TaskId } from '@crewstation/contracts';
import type { DevelopmentCleanupEvidence, DevelopmentCleanupSelection } from '../domain/development/cleanup';
import type { DevelopmentEndingDeps, DevelopmentEndingSession } from './developmentEnding';
import type { Environments } from './runtime';

export interface DevelopmentCleanupSession extends DevelopmentEndingSession {
  getDevelopmentUsage(taskId: TaskId, key: DevelopmentUsageKey): Promise<StoredDevelopmentUsage | undefined>;
}
export interface DevelopmentCleanupDeps extends Omit<DevelopmentEndingDeps, 'session'> {
  session: DevelopmentCleanupSession;
  environments: Pick<Environments, 'getEnvironment'>;
  /** Deletion-only closure of this already-verified original admission, not a physical stop assertion. */
  closeOriginalAdmission?(id: TaskId): Promise<void>;
}
export interface DevelopmentCleanupParticipant {
  advance(input: DevelopmentCleanupSelection): Promise<{ readonly kind: 'waiting'; readonly reason: string } | { readonly kind: 'permitted'; readonly evidence: DevelopmentCleanupEvidence }>;
}
