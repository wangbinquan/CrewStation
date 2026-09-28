import type { ProjectId, ServiceId, TaskId, TaskInputObject } from '@crewstation/contracts';

/** Data owns pins. Only a conclusive admission rejection may abort; an unknown reply keeps them. */
export interface TaskInputPreparation {
  prepare(input: { projectId: ProjectId; serviceId: ServiceId; taskId: TaskId; generation: number; items: readonly TaskInputObject[] }): Promise<void>;
  commit(taskId: TaskId, generation: number): Promise<void>;
  abort(taskId: TaskId, generation: number, retryable: boolean): Promise<void>;
}
