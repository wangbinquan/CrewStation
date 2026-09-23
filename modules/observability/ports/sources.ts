import type { Actor, LogEntryDto, ProjectId, ResourceChild, ResourceCondition, ServiceId } from '@crewstation/contracts';

export interface ProjectAuthorizer {
  authorize(actor: Actor, projectId: ProjectId, action: 'view'): Promise<unknown>;
}

export interface ServiceResolver {
  resolveServiceOfProject(projectId: ProjectId): Promise<{ serviceId: ServiceId; slug: string; name: string; namespace: string } | undefined>;
}

/** 由 release 提供：两个物理槽的角色，用于把 prod／preview 映射到 Deployment 名。 */
export interface SlotRoles {
  slotRoles(serviceId: ServiceId): Promise<{ prod: 'blue' | 'green'; preview: 'blue' | 'green' } | undefined>;
}

/** 服务槽记录里健康判定用得到的部分（RFC-025 第三期）：物理槽、子对象观测（Deployment 与它的 Pod）、条件、阶段起点。 */
export interface SlotRecordView {
  readonly physical: string;
  readonly children: readonly ResourceChild[];
  readonly conditions: readonly ResourceCondition[];
  readonly phaseSince: string;
}

/** 由组合根从资源中心提供：项目的服务槽记录（含已结束的）；读失败抛错，调用方退回按请求读集群。 */
export interface SlotRecords {
  slotRecords(projectId: ProjectId): Promise<readonly SlotRecordView[]>;
}

export interface WorkloadObservation {
  replicas: number;
  readyReplicas: number;
  restarts: number;
  lastRestartAgeSeconds?: number;
  lastTransitionAt: string;
}

/** 集群观测：Deployment 状态与 Pod 日志；实现在 adapters/k8s。 */
export interface ClusterObserver {
  observeDeployment(namespace: string, name: string): Promise<WorkloadObservation | undefined>;
  tailLogs(namespace: string, selector: string, options: { tailLines: number; sinceSeconds?: number }): Promise<LogEntryDto[]>;
}
