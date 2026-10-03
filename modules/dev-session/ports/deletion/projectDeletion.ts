import type { ProjectDeletionContext, ProjectDeletionEvidence, ProjectDeletionInventory, ProjectDeletionTarget } from '@crewstation/contracts';
import type { DevelopmentDeletionScope } from '../../domain/deletion/projectDeletion';
import type { DevelopmentWorkCallback } from '../../domain/deletion/work';

export interface DevelopmentDeletionRepository {
  inspect(target: ProjectDeletionTarget): Promise<{ inventory: ProjectDeletionInventory; scope: DevelopmentDeletionScope }>;
  seal(context: ProjectDeletionContext): Promise<boolean>;
  scope(context: ProjectDeletionContext): Promise<DevelopmentDeletionScope>;
  proof(context: ProjectDeletionContext): Promise<ProjectDeletionEvidence | undefined>;
  record(context: ProjectDeletionContext, evidence: ProjectDeletionEvidence): Promise<void>;
  exited(callback: DevelopmentWorkCallback): Promise<boolean>;
  legacyPending(context: ProjectDeletionContext): Promise<boolean>;
  observe(): Promise<void>;
  purge(context: ProjectDeletionContext): Promise<void>;
}
