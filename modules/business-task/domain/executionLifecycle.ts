import type { BusinessOperationDto, BusinessTaskStateV3, TaskId } from '@crewstation/contracts';

export type LifecycleAction = 'pause' | 'resume' | 'close' | 'rebuild';
export interface ExecutionLifecycle {
  id: string; serviceId: string; taskId: TaskId; action: LifecycleAction; requestKey: string;
  expectedGeneration: number; generation: number; priorState: BusinessTaskStateV3;
  state: BusinessOperationDto['state']; epoch: number | null; dispatched: boolean;
  revision: number; owner: string | null; errorCode: string | null;
}
export interface ExecutionTaskState { generation: number; state: BusinessTaskStateV3; operationId: string | null }
export const lifecycleView = (operation: ExecutionLifecycle): BusinessOperationDto => ({ operationId: operation.id, taskId: operation.taskId, state: operation.state, ...(operation.errorCode ? { message: operation.errorCode } : {}) });
