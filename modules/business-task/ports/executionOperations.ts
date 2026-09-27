import type { ExecutionOperation, ExecutionOperationState, OperationCandidate, OperationKey, OperationLease } from '../domain/taskAdmission';
import type { ExecutionAuthorization } from '../domain/executionControl';

export interface ExecutionOperations {
  find(key: OperationKey): Promise<ExecutionOperation | undefined>;
  get(id: string): Promise<ExecutionOperation | undefined>;
  forTask(serviceId: string, taskId: string): Promise<ExecutionOperation | undefined>;
  reserve(candidate: OperationCandidate, authorization?: ExecutionAuthorization): Promise<{ operation: ExecutionOperation; created: boolean }>;
  /** 只认已持久化的意图；过期 running 可以对账重放原 ID，429 只能由调用方显式重试。 */
  claim(input: { owner: string; leaseSeconds: number; id?: string }): Promise<ExecutionOperation | undefined>;
  renew(lease: OperationLease, leaseSeconds: number): Promise<boolean>;
  settle(lease: OperationLease, state: Exclude<ExecutionOperationState, 'running' | 'retryable-rejected'> | 'retryable-rejected', errorCode?: string): Promise<boolean>;
  retryRejected(key: OperationKey, requestDigest: string, authorization?: ExecutionAuthorization): Promise<ExecutionOperation>;
  adoptPending(key: OperationKey, requestDigest: string, authorization?: ExecutionAuthorization): Promise<ExecutionOperation>;
}
