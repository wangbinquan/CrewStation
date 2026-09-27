import type { BusinessEventPage, BusinessEventQuery, BusinessOutputDto, RunnerBusinessEvent, StoredBusinessExecutionDto, TaskId } from '@crewstation/contracts';
import type { ExecutionOperation } from '../domain/taskAdmission';
import type { ExecutionTaskState } from '../domain/executionLifecycle';
import type { BusinessTaskStateV3 } from '@crewstation/contracts';
import type { ExecutionSubtask } from '../domain/executionSubtask';

export interface TaskObservation { operation: ExecutionOperation; lifecycle?: ExecutionTaskState }

export interface ExecutionProjection {
  taskObservations(): Promise<TaskObservation[]>;
  observeTask(candidate: TaskObservation, state: BusinessTaskStateV3): Promise<boolean>;
  pendingConsumption(): Promise<Array<{ subtaskId: string; taskId: TaskId; executionId: string; through: number; stopped: boolean }>>;
  consumed(subtaskId: string): Promise<void>;
  expire(): Promise<number>;
  pending(limit: number): Promise<Array<{ subtask: ExecutionSubtask; sourceSequence: number }>>;
  append(subtask: ExecutionSubtask, snapshot: StoredBusinessExecutionDto, events: RunnerBusinessEvent[]): Promise<void>;
  events(serviceId: string, taskId: TaskId, query: BusinessEventQuery): Promise<BusinessEventPage>;
  output(serviceId: string, taskId: TaskId, subtaskId: string): Promise<BusinessOutputDto>;
}
