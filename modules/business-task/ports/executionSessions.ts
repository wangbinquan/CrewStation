import type { TaskId } from '@crewstation/contracts';
import type { ExecutionSession } from '../domain/executionSession';
export interface ExecutionSessions {
  get(serviceId: string, taskId: TaskId, sessionId: string): Promise<ExecutionSession | undefined>;
}
