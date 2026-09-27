import type { TaskId } from '@crewstation/contracts';
export interface ExecutionSession {
  serviceId: string; taskId: TaskId; sessionId: string; sessionKey: TaskId; volumeUid: string;
  sourceExecutionId: string; leaseExecutionId: string | null; state: 'occupied' | 'idle' | 'lost';
}
