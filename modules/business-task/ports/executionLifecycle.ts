import type { BusinessTaskMutation, TaskId } from '@crewstation/contracts';
import type { ExecutionAuthorization } from '../domain/executionControl';
import type { ExecutionLifecycle, ExecutionTaskState, LifecycleAction } from '../domain/executionLifecycle';

export interface ExecutionLifecycles {
  read(serviceId: string, taskId: TaskId): Promise<ExecutionTaskState | undefined>;
  get(id: string): Promise<ExecutionLifecycle | undefined>;
  request(serviceId: string, taskId: TaskId, action: LifecycleAction, input: BusinessTaskMutation, observed: ExecutionTaskState['state'], authorization: ExecutionAuthorization): Promise<ExecutionLifecycle>;
  claim(owner: string, id?: string): Promise<ExecutionLifecycle | undefined>;
  settle(operation: ExecutionLifecycle, state: 'pending' | 'succeeded' | 'failed' | 'retryable-rejected', errorCode?: string): Promise<boolean>;
}
