import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionTarget } from '@crewstation/contracts';

export interface ObservabilityProjectDirectory {
  aliases(kind: string, id: string): Promise<readonly (readonly string[])[]>;
  resolve(kind: string, keys: readonly string[]): Promise<string | undefined>;
}
/** Includes retained historical task IDs; an incomplete source never proves an orphan empty. */
export interface ObservabilityDeletionTasks {
  list(target: ProjectDeletionTarget): Promise<{ ids: readonly string[]; complete: boolean }>;
}
export interface ObservabilityDeletionRepository {
  inspect(target: ProjectDeletionTarget): Promise<ProjectDeletionInventory>;
  seal(context: ProjectDeletionContext): Promise<boolean | 'waiting'>;
  step(context: ProjectDeletionContext): Promise<{ count: number; digest: string }>;
}
