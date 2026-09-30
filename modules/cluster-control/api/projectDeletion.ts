import type { ProjectDeletionContext, ProjectDeletionOwner } from '@crewstation/contracts';

export interface DeletionVolumeIdentity { readonly kind: string; readonly metadata: { readonly name: string; readonly uid?: string }; readonly [key: string]: unknown }
/** resources 保有原记录及持久闭准入事实，集群 owner 只操作自己的物理来源。 */
export interface ClusterDeletionAdmission {
  assertGrant(context: ProjectDeletionContext): Promise<void>;
  seal(context: ProjectDeletionContext): Promise<void>;
  assertSealed(context: ProjectDeletionContext): Promise<void>;
  ownsVolume?(projectId: string, volume: DeletionVolumeIdentity): Promise<boolean>;
}
export type ClusterDeletionOwnerFactory = (admission: ClusterDeletionAdmission) => ProjectDeletionOwner;
