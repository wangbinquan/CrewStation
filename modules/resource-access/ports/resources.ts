import type { Actor, ProjectId, ResourceTarget, ResourceTargetDescription, ResourceType, ResourceValues, UserId } from '@crewstation/contracts';

/** 每个领域自行解释修订和生效条件。禁止通过本模块读取其他 schema。 */
export type ResourceTargetView = ResourceTargetDescription;
export interface ResourceAdapter {
  resourceType: ResourceType;
  list(projectId: ProjectId): Promise<ResourceTargetView[]>;
  read(projectId: ProjectId, target: ResourceTarget): Promise<ResourceTargetView>;
  /** 相同 operationId 必须幂等；不得启动、重建或终止已有工作负载。 */
  apply(command: { operationId: string; actor: Actor; projectId: ProjectId; target: ResourceTarget; expectedRevision: string; values: ResourceValues; requestedBy: UserId; reason: string }): Promise<{ revision: string; effect: string; applied: boolean }>;
  /** 原 operationId 的领域写入已提交的稳定回执；不能只返回受理 ACK。applied 另描述实际资源生效，由其 owner 负责物理清理证明。 */
  recover?(projectId: ProjectId, operationId: string): Promise<{ revision: string; effect: string; applied: boolean } | undefined>;
  observe?(projectId: ProjectId, target: ResourceTarget, receipt: { revision: string; effect: string }, operationId: string): Promise<{ applied: boolean; effect: string }>;
}
export interface ResourceProjectAccess {
  authorize(actor: Actor, projectId: ProjectId, action: 'view' | 'request-resources'): Promise<'admin' | 'owner' | 'developer' | 'tester' | 'user'>;
  isAdmin(userId: UserId): Promise<boolean>;
  active(projectId: ProjectId): Promise<boolean>;
  requesterName(userId: UserId): Promise<string | null>;
}
