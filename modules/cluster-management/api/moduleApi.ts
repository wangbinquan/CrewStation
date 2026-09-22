import type { Actor, ClusterFilter, ClusterSummary, ClusterPage, ClusterDetail, ClusterEvents, ClusterLogs, ClusterLogsQuery, ClusterInspectRequest, ClusterInspection, ClusterOperation, ClusterOperationRequest, ClusterOperationQuery, ProjectClusterResources } from '@crewstation/contracts';
export interface ClusterManagementModuleApi {
  readonly name: 'cluster-management';
  summary(actor: Actor, query: ClusterFilter): Promise<ClusterSummary>;
  resources(actor: Actor, query: ClusterFilter): Promise<ClusterPage>;
  /** 项目成员（develop 动作）读本项目的受管资源，没有管理动作（RFC-019）。 */
  projectResources(actor: Actor, projectId: string, snapshotId?: string): Promise<ProjectClusterResources>;
  detail(actor: Actor, resourceId: string, snapshotId?: string): Promise<ClusterDetail>;
  events(actor: Actor, resourceId: string): Promise<ClusterEvents>;
  logs(actor: Actor, resourceId: string, query: ClusterLogsQuery): Promise<ClusterLogs>;
  refresh(actor: Actor): Promise<{ refreshId: string }>;
  inspect(actor: Actor, resourceId: string, request: ClusterInspectRequest): Promise<ClusterInspection>;
  accept(actor: Actor, request: ClusterOperationRequest): Promise<ClusterOperation>;
  operations(actor: Actor, query: ClusterOperationQuery): Promise<{ items: ClusterOperation[] }>;
  reconcile(actor: Actor, id: string): Promise<ClusterOperation>;
  operation(actor: Actor, id: string): Promise<ClusterOperation>;
}
