import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionTarget } from '@crewstation/contracts';

export interface ResourceAccessDeletionRepository {
  inspect(target: ProjectDeletionTarget): Promise<ProjectDeletionInventory>;
  seal(context: ProjectDeletionContext): Promise<'sealed' | 'changed' | 'waiting'>;
  assertSealed(context: ProjectDeletionContext): Promise<void>;
  purge(context: ProjectDeletionContext): Promise<void>;
  unprotectedWork(context: ProjectDeletionContext): Promise<Array<{ changeId: string; generation: number }>>;
  recoverWork(context: ProjectDeletionContext, changeId: string, generation: number, digest: string): Promise<void>;
}
