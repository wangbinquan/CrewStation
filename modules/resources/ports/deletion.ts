import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectId } from '@crewstation/contracts';
export interface ResourceDeletionRepository {
  inspect(projectId: ProjectId, namespace: string): Promise<ProjectDeletionInventory>;
  seal(context: ProjectDeletionContext): Promise<boolean>;
  assertSealed(context: ProjectDeletionContext): Promise<void>;
  purgeMetadata(context: ProjectDeletionContext): Promise<void>;
  withAdmission(projectId: ProjectId, work: () => Promise<void>): Promise<boolean>;
}
