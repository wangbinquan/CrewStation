import type { BusinessTaskMutation, RuntimeImageExecutionSnapshot, TaskId } from '@crewstation/contracts';
import type { ExecutionAuthorization } from '../domain/executionControl';
import type { ExecutionLifecycle, ExecutionTaskState, LifecycleAction, RuntimeImageUpgradePayload } from '../domain/executionLifecycle';

/** RFC-043: the caller release's selection resolved before admission; the transaction adds the pin it replaces. */
export type RuntimeImageUpgradeRequest = Omit<RuntimeImageUpgradePayload, 'fromVersionId'>;
export interface ExecutionLifecycles {
  read(serviceId: string, taskId: TaskId): Promise<ExecutionTaskState | undefined>;
  get(id: string): Promise<ExecutionLifecycle | undefined>;
  request(serviceId: string, taskId: TaskId, action: LifecycleAction, input: BusinessTaskMutation, observed: ExecutionTaskState['state'], authorization: ExecutionAuthorization, upgrade?: RuntimeImageUpgradeRequest): Promise<ExecutionLifecycle>;
  claim(owner: string, id?: string): Promise<ExecutionLifecycle | undefined>;
  /** Records the new pin while the claimed upgrade still owns the task; false when ownership was lost. */
  recordRuntimeImage(operation: ExecutionLifecycle, snapshot: RuntimeImageExecutionSnapshot): Promise<boolean>;
  settle(operation: ExecutionLifecycle, state: 'pending' | 'succeeded' | 'failed' | 'retryable-rejected', errorCode?: string): Promise<boolean>;
}
