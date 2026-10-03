import type { Actor, ProjectDeletionOperation, ProjectDeletionOwner, ProjectId } from '@crewstation/contracts';
import type { ProjectDeletionController } from './deletion';

export interface ProvisioningInfrastructureSources {
  resolve(document: { readonly channel: 'queue' | 'event'; readonly name: string; readonly payload: unknown; readonly legacyPayload: unknown; readonly identityProvenance: unknown },
    reference: { readonly kind: 'project' | 'service' | 'release' | 'task' | 'subtask' | 'delivery' | 'profile-test' | 'rebuild' | 'parent-ending'
      | 'cluster-refresh' | 'cluster-operation' | 'cluster-metrics' | 'cluster-storage' | 'resource-change' | 'deletion' | 'api-operation'; readonly key: string },
    representation: 'current' | 'legacy'): Promise<{ readonly complete: true; readonly id: string; readonly scope: 'project' | 'platform'; readonly projectIds: readonly ProjectId[]; readonly revision: string } | undefined>;
}

/** 一轮命名空间重下发的结果（RFC-018）：成功与失败的项目数，用于日志与用例断言。 */
export interface ReapplyOutcome {
  readonly applied: number;
  readonly failed: number;
}

export interface ProvisioningModuleApi {
  readonly name: 'provisioning';
  readonly deletions?: ProjectDeletionController;
  projectDeletionOwner(input: { origins: ProvisioningInfrastructureSources; coordinator(projectId: ProjectId): Promise<{ readonly operationId: string; readonly projectId: ProjectId } | undefined> }): ProjectDeletionOwner;
  finalizeProjectDeletion(executor: object, operation: ProjectDeletionOperation): Promise<void>;
  /** 管理员在工作卷等资源处理完后，删除归档项目的命名空间。 */
  deleteNamespace(actor: Actor, id: string): Promise<void>;
  /** 同步执行一次开通链（CLI 与测试用）；正常路径由 project.created 事件入队。 */
  provisionProject(projectId: ProjectId): Promise<'active' | 'failed' | 'skipped'>;
  /** 重新开通失败的项目。 */
  retry(projectId: ProjectId): Promise<void>;
  /** 对全部未归档项目重跑 `ensureNamespace`（RFC-018）；控制面启动时调用一次。 */
  reapplyNamespaces(): Promise<ReapplyOutcome>;
  reapplyProjectNamespace(projectId: ProjectId): Promise<void>;
}
