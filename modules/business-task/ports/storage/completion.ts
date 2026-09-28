import type { ExecutionCompletionProof, TaskId } from '@crewstation/contracts';
import type { FinalizationLease, FinalizationOperation } from '../../domain/finalization/operation';

export interface CompletionCandidate {
  readonly subtaskId: string; readonly executionTaskId: TaskId; readonly executionId: string;
  readonly state: string; readonly requiresSessionProof: boolean;
}
export interface FinalizationCompletion {
  /** Ordered, bounded scan of all attempts, including failed predecessors. Frozen tasks cannot add entries. */
  page(operationId: string): Promise<CompletionCandidate[]>;
  /** Revalidates the exact page and every durable projection under the service admission lock. */
  confirm(lease: FinalizationLease, items: readonly { subtaskId: string; proof: ExecutionCompletionProof | null }[]): Promise<FinalizationOperation | undefined>;
}
