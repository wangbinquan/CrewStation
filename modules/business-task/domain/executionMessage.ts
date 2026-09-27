import type { BusinessOperationDto, TaskId } from '@crewstation/contracts';
export interface ExecutionMessage {
  id: string; serviceId: string; taskId: TaskId; subtaskId: string; requestKey: string; requestDigest: string;
  attempt: number; executionId: string; runtimeTaskId: TaskId; incarnation: string; payloadDigest: string; sealedPayload: string;
  epoch: number | null; dispatched: boolean;
  state: 'pending' | 'dispatching' | 'awaiting' | 'unknown' | 'succeeded' | 'failed'; errorCode: string | null;
  owner: string | null; revision: number;
}
export function messageView(message: ExecutionMessage): BusinessOperationDto {
  return { operationId: message.id, taskId: message.taskId, subtaskId: message.subtaskId as BusinessOperationDto['subtaskId'],
    state: message.state === 'succeeded' || message.state === 'failed' ? message.state : message.state === 'pending' ? 'pending' : 'running',
    ...(message.errorCode ? { message: message.errorCode } : {}) };
}
