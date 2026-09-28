import type { BusinessSubtaskV3Dto, ExecutionObservationIdentity, RunnerBusinessReceipt, TaskId } from '@crewstation/contracts';
import type { ExecutionAuthorization } from '../domain/executionControl';
import type { ExecutionSubtask } from '../domain/executionSubtask';

export type SubtaskCandidate = Omit<ExecutionSubtask, 'dispatch' | 'incarnation' | 'receipt' | 'revision' | 'owner' | 'leaseUntil'>;
export interface ExecutionSubtasks {
  forRuntimeExecution(runtimeTaskId: TaskId, executionId: string): Promise<ExecutionSubtask | undefined>;
  forExecution(serviceId: string, taskId: TaskId, executionId: string): Promise<ExecutionSubtask | undefined>;
  find(serviceId: string, taskId: TaskId, requestKey: string, requestKind?: 'submit' | 'retry', requestParent?: string): Promise<ExecutionSubtask | undefined>;
  get(serviceId: string, taskId: TaskId, id: string): Promise<ExecutionSubtask | undefined>;
  checkpointRuntime(claim: ExecutionSubtask): Promise<boolean>;
  markRuntimeReleased(subtask: ExecutionSubtask): Promise<void>;
  cleanupCandidates(limit: number): Promise<ExecutionSubtask[]>;
  list(serviceId: string, taskId: TaskId): Promise<ExecutionSubtask[]>;
  reserve(candidate: SubtaskCandidate, authorization: ExecutionAuthorization): Promise<{ subtask: ExecutionSubtask; created: boolean }>;
  adoptPending(subtask: ExecutionSubtask, authorization: ExecutionAuthorization): Promise<ExecutionSubtask>;
  claim(owner: string, id?: string): Promise<ExecutionSubtask | undefined>;
  checkpoint(claim: ExecutionSubtask, incarnation: string): Promise<boolean>;
  settle(claim: ExecutionSubtask, update: { dispatch: 'pending' | 'accepted' | 'unknown' | 'failed' | 'retryable-rejected'; receipt?: RunnerBusinessReceipt; runtimeAdmitted?: boolean; runtimeDispatched?: boolean; view: BusinessSubtaskV3Dto }): Promise<boolean>;
}

/** Composition injects the price owner; business-task never reads pricing storage. */
export interface ExecutionObservationAdmission {
  accept(input: { identity: ExecutionObservationIdentity;
    profile: { id: string; revision: number; protocol: 'opencode' | 'claude-code' | 'terminal' } | null }): Promise<void>;
}
