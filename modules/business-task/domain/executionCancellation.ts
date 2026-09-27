import type { BusinessOperationDto, TaskId } from '@crewstation/contracts';

export interface ExecutionCancellation {
  id: string; serviceId: string; taskId: TaskId; subtaskId: string; requestKey: string; requestDigest: string;
  expectedAttempt: number; epoch: number | null;
  state: 'pending' | 'dispatching' | 'awaiting' | 'succeeded'; errorCode: string | null;
  owner: string | null; revision: number;
}
export function cancellationView(operation: ExecutionCancellation): BusinessOperationDto {
  return { operationId: operation.id, taskId: operation.taskId, subtaskId: operation.subtaskId as BusinessOperationDto['subtaskId'],
    state: operation.state === 'succeeded' ? 'succeeded' : operation.state === 'pending' ? 'pending' : 'running',
    ...(operation.errorCode ? { message: operation.errorCode } : {}) };
}
