import type { ProjectDeletionContext, ProjectDeletionEvidence, ProjectDeletionInventory, ProjectDeletionStepResult, ProjectDeletionTarget } from '@crewstation/contracts';
import type { RuntimeDeletionScope } from '../../domain/deletion/projectDeletion';
import type { RuntimeWorkCallback } from '../../domain/deletion/work';

export interface RuntimeDeletionRepository {
  inspect(target: ProjectDeletionTarget): Promise<{ inventory: ProjectDeletionInventory; scope: RuntimeDeletionScope }>;
  seal(context: ProjectDeletionContext): Promise<boolean>;
  scope(context: ProjectDeletionContext): Promise<RuntimeDeletionScope>;
  proof(context: ProjectDeletionContext): Promise<ProjectDeletionEvidence | undefined>;
  record(context: ProjectDeletionContext, evidence: ProjectDeletionEvidence): Promise<void>;
  exited(callback: RuntimeWorkCallback): Promise<boolean>;
  pending(context: ProjectDeletionContext): Promise<boolean>;
  observe(): Promise<void>;
  captureStopped(context: ProjectDeletionContext, stop: ProjectDeletionEvidence): Promise<RuntimeDeletionScope>;
  purge(context: ProjectDeletionContext): Promise<ProjectDeletionEvidence>;
}
/** The real stop implementation must finish the original numeric/physical chain before returning done. */
export interface RuntimeDeletionStop {
  stop(context: ProjectDeletionContext, scope: RuntimeDeletionScope): Promise<ProjectDeletionStepResult>;
}
