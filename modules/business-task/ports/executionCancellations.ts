import type { BusinessSubtaskMutation, TaskId } from '@crewstation/contracts';
import type { ExecutionAuthorization } from '../domain/executionControl';
import type { ExecutionCancellation } from '../domain/executionCancellation';

export interface ExecutionCancellations {
  finishStopped(operation: ExecutionCancellation): Promise<boolean>;
  finishBeforeStart(operation: ExecutionCancellation): Promise<boolean>;
  request(serviceId: string, taskId: TaskId, subtaskId: string, input: BusinessSubtaskMutation, authorization: ExecutionAuthorization): Promise<ExecutionCancellation>;
  get(id: string): Promise<ExecutionCancellation | undefined>;
  claim(owner: string, id?: string): Promise<ExecutionCancellation | undefined>;
  settle(operation: ExecutionCancellation, state: 'pending' | 'awaiting' | 'succeeded', errorCode?: string): Promise<boolean>;
}
