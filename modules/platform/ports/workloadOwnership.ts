import type { ProjectId, ReleaseId, ServiceId, TaskId } from '@crewstation/contracts';

export interface OriginalWorkloadProject {
  resolveServiceById(id: ServiceId): Promise<{ projectId: ProjectId; serviceId: ServiceId; identity: string; namespace: string } | undefined>;
  assertProjectAvailable(id: ProjectId): Promise<void>;
}
export interface OriginalWorkloadRelease {
  sourceOwnership(id: ReleaseId): Promise<{ projectId: ProjectId; serviceId: ServiceId } | undefined>;
}
export interface OriginalWorkloadTasks {
  getEnvironment(id: TaskId): Promise<{ projectId: ProjectId; serviceId: string; kind: string; state: string; podName: string; native?: { podUid?: string } } | undefined>;
}
