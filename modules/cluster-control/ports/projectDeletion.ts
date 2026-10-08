import type { ProjectDeletionContext, ProjectDeletionOwner } from '@crewstation/contracts';

export interface ProjectClusterDeletion {
  inspect: ProjectDeletionOwner['inspect'];
  /** 原网关和凭据实体按原 UID 清理；删除受理不能代替后续完整 discovery。 */
  reclaimObjects(context: ProjectDeletionContext): Promise<void>;
  removeNamespace(context: ProjectDeletionContext, namespaceUid: string): Promise<boolean>;
}
