import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectId } from '@crewstation/contracts';

export interface ConfigDeletionRepository {
  inspect(projectId: ProjectId): Promise<ProjectDeletionInventory>;
  seal(context: ProjectDeletionContext): Promise<boolean>;
  assertSealed(context: ProjectDeletionContext): Promise<void>;
  purge(context: ProjectDeletionContext): Promise<void>;
}
