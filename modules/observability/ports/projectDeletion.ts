import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionTarget } from '@crewstation/contracts';

export interface ObservabilityProjectDirectory {
  aliases(kind: string, id: string): Promise<readonly (readonly string[])[]>;
  resolve(kind: string, keys: readonly string[]): Promise<string | undefined>;
}
export interface ObservabilityDeletionRepository {
  inspect(target: ProjectDeletionTarget): Promise<ProjectDeletionInventory>;
  seal(context: ProjectDeletionContext): Promise<boolean | 'waiting'>;
  step(context: ProjectDeletionContext): Promise<{ count: number; digest: string }>;
}
