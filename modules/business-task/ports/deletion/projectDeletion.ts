import type { ProjectDeletionContext, ProjectDeletionEvidence, ProjectDeletionInventory, ProjectDeletionTarget } from '@crewstation/contracts';
import type { BusinessDeletionScope } from '../../domain/deletion/projectDeletion';
import type { BusinessWorkCallback } from '../../domain/deletion/work';

export interface BusinessDeletionRepository {
  inspect(target: ProjectDeletionTarget): Promise<{ inventory: ProjectDeletionInventory; scope: BusinessDeletionScope }>;
  seal(context: ProjectDeletionContext): Promise<boolean>;
  scope(context: ProjectDeletionContext): Promise<BusinessDeletionScope>;
  proof(context: ProjectDeletionContext): Promise<ProjectDeletionEvidence | undefined>;
  record(context: ProjectDeletionContext, evidence: ProjectDeletionEvidence): Promise<void>;
  exited(callback: BusinessWorkCallback): Promise<boolean>;
  legacyPending(context: ProjectDeletionContext): Promise<boolean>;
  observe(): Promise<void>;
  purge(context: ProjectDeletionContext): Promise<void>;
}
