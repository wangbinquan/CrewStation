import type { BusinessRecoveryAction, BusinessRecoveryRequest, BusinessRecoveryClaimReceipt, RequestBusinessRecovery } from '@crewstation/contracts';
import type { ExecutionAuthorization } from '../domain/executionControl';

/** Resource proofs are checked by the application before admission; the repository rechecks all local state under the service lock. */
export interface RecoveryAdmission {
  projectId: string; serviceId: string; requestedBy: string; request: RequestBusinessRecovery;
  /** Current assessment digest calculated from verified facts, never copied from the client. */
  assessmentDigest: string;
  controlEpoch: number;
}
export interface RecoveryOwnership { claimId: string; authorization: ExecutionAuthorization }
export interface RecoveryMutation {
  taskId: string; subtaskId?: string; action: BusinessRecoveryAction; requestKey: string;
  expectedGeneration?: number; expectedAttempt?: number; resumeSessionId?: string;
}
export interface TaskRecoveryRequests {
  request(input: RecoveryAdmission): Promise<BusinessRecoveryRequest>;
  get(serviceId: string, id: string): Promise<BusinessRecoveryRequest | undefined>;
  list(serviceId: string, taskId: string, limit: number): Promise<BusinessRecoveryRequest[]>;
  claim(serviceId: string, authorization: ExecutionAuthorization, id?: string): Promise<BusinessRecoveryClaimReceipt | undefined>;
  reject(serviceId: string, id: string, ownership: RecoveryOwnership, reason: string): Promise<BusinessRecoveryRequest>;
  authorize(serviceId: string, mutation: RecoveryMutation, authorization: ExecutionAuthorization): Promise<void>;
  /** Internal projection from committed platform operations, never an application-supplied success. */
  reconcile(): Promise<number>;
}
