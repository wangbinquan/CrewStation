import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionStepResult, ProjectDeletionTarget, ProjectId, TaskVolumeTarget } from '@crewstation/contracts';
export interface ClusterVolumeReclaimReceipt { key: string; target: TaskVolumeTarget; digest: string | null; observedAt: string | null }
export interface ClusterVolumeReclamationStore {
  known(projectId: ProjectId): Promise<TaskVolumeTarget[]>;
  get(context: ProjectDeletionContext, key: string): Promise<ClusterVolumeReclaimReceipt | undefined>;
  pin(context: ProjectDeletionContext, key: string, target: TaskVolumeTarget): Promise<void>;
  reclaimed(context: ProjectDeletionContext, key: string, digest: string, observedAt: string): Promise<void>;
}
export interface ProjectVolumeReclamation {
  inspect(target: ProjectDeletionTarget): Promise<ProjectDeletionInventory>;
  seal(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
  purge(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
  prove(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
  verify(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
}
