import type { ProjectId, ServiceId, TaskId } from '@crewstation/contracts';

export interface ProductionAccessTasks {
  get(taskId: TaskId): Promise<{ taskId: TaskId; projectId: ProjectId; serviceId: ServiceId; kind: string; state: string; podUid: string | null } | undefined>;
  list(projectId: ProjectId): Promise<TaskId[]>;
}
