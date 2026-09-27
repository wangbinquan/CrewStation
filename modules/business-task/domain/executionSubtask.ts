import type { BusinessSubtaskV3Dto, RunnerBusinessReceipt, TaskId } from '@crewstation/contracts';

/** Payloads contain business env/prompt and must be encrypted before entering the journal. */
export interface ExecutionSubtask {
  serviceId: string;
  taskId: TaskId;
  runtimeTaskId?: TaskId | null;
  sessionKey?: TaskId | null;
  sessionVolumeUid?: string | null;
  runtimeDispatched?: boolean;
  runtimeAdmitted?: boolean;
  runtimeReleased?: boolean;
  requestKind: 'submit' | 'retry';
  requestParent: string;
  requestKey: string;
  requestDigest: string;
  sealedPayload: string;
  payloadDigest: string;
  fenced: boolean;
  epoch: number | null;
  view: BusinessSubtaskV3Dto;
  dispatch: 'pending' | 'dispatching' | 'accepted' | 'unknown' | 'failed' | 'retryable-rejected';
  incarnation: string | null;
  receipt: RunnerBusinessReceipt | null;
  revision: number;
  owner: string | null;
  leaseUntil: string | null;
}
export interface ExecutionPayloadCipher {
  seal(plain: string): Promise<string>;
  open(sealed: string): Promise<string>;
}

export function executionRunnerTaskId(subtask: ExecutionSubtask): TaskId { return subtask.runtimeTaskId ?? subtask.taskId; }
