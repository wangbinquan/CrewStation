import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionStepResult, ProjectDeletionTarget } from '@crewstation/contracts';

export interface ClusterPodStopReceipt { key: string; uid: string; nodeUid: string | null; digest: string; observedAt: string }
export interface ClusterPodStopReceipts {
  get(context: ProjectDeletionContext, key: string, uid: string): Promise<ClusterPodStopReceipt | undefined>;
  save(context: ProjectDeletionContext, receipt: ClusterPodStopReceipt): Promise<void>;
}
export interface ProjectPodProtection {
  inspect(target: ProjectDeletionTarget): Promise<ProjectDeletionInventory>;
  seal(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
  stop(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
  verify(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
}
