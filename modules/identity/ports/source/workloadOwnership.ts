import type { ProjectId, ServiceId, WorkloadIdentity } from '@crewstation/contracts';

/** 从原 release/task UUID 与实际 Pod 实例解析，不能以当前同名目录补认旧工作负载。 */
export interface WorkloadOwnership {
  resolve(workload: WorkloadIdentity): Promise<{ projectId: ProjectId; serviceId: ServiceId } | undefined>;
}
