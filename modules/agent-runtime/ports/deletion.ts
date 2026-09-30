import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionTarget, ProjectId } from '@crewstation/contracts';

export interface ComputeDeletionRepository {
  inspect(target: ProjectDeletionTarget): Promise<ProjectDeletionInventory>;
  seal(context: ProjectDeletionContext): Promise<boolean>;
  assertSealed(context: ProjectDeletionContext): Promise<void>;
  purge(context: ProjectDeletionContext): Promise<void>;
  assertAvailable(projectId: ProjectId): Promise<void>;
}
