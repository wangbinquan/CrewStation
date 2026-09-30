import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionTarget } from '@crewstation/contracts';
export interface ApiCatalogDeletionRepository {
  inspect(target: ProjectDeletionTarget): Promise<ProjectDeletionInventory>;
  seal(context: ProjectDeletionContext): Promise<boolean>;
  assertSealed(context: ProjectDeletionContext): Promise<void>;
  purge(context: ProjectDeletionContext): Promise<void>;
}
