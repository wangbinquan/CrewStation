import type { ProjectDeletionContext, ProjectId, TaskVolumeTarget } from '@crewstation/contracts';

/** 原供应器位置是物理清理身份；没有文件内容、口令或可执行配置。 */
export interface ProjectVolumeReclaimReceipt { key: string; target: TaskVolumeTarget; digest: string | null; observedAt: string | null }
export interface ProjectVolumeReclamationStore {
  known(projectId: ProjectId): Promise<TaskVolumeTarget[]>;
  get(context: ProjectDeletionContext, key: string): Promise<ProjectVolumeReclaimReceipt | undefined>;
  pin(context: ProjectDeletionContext, key: string, target: TaskVolumeTarget): Promise<void>;
  reclaimed(context: ProjectDeletionContext, key: string, digest: string, observedAt: string): Promise<void>;
}
