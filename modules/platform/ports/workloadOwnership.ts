import type { DevelopmentSourceBinding, ProjectId, ReleaseId, ServiceId, ServiceSourceBinding, TaskId } from '@crewstation/contracts';

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

/** 已观测索引的历史归属读取，只有原 UUID 沿革，不作为物理停止证明。 */
export interface GatewayHistoryPod {
  project: string; service: string; namespace: string; podName: string; workload: string;
  podUid?: string; taskId?: string; source?: ServiceSourceBinding; developmentSource?: DevelopmentSourceBinding;
}
