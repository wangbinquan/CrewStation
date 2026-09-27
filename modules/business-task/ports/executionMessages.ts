import type { ExecutionAuthorization } from '../domain/executionControl';
import type { ExecutionMessage } from '../domain/executionMessage';
export type MessageCandidate = Omit<ExecutionMessage, 'state' | 'owner' | 'revision' | 'errorCode' | 'dispatched'>;
export interface ExecutionMessages {
  find(serviceId: string, taskId: string, subtaskId: string, requestKey: string): Promise<ExecutionMessage | undefined>;
  get(id: string): Promise<ExecutionMessage | undefined>;
  reserve(candidate: MessageCandidate, authorization: ExecutionAuthorization): Promise<ExecutionMessage>;
  adopt(message: ExecutionMessage, authorization: ExecutionAuthorization): Promise<ExecutionMessage>;
  claim(owner: string, id?: string): Promise<ExecutionMessage | undefined>;
  checkpoint(claim: ExecutionMessage): Promise<boolean>;
  settle(claim: ExecutionMessage, state: 'pending' | 'awaiting' | 'unknown' | 'succeeded' | 'failed', errorCode?: string): Promise<boolean>;
}
