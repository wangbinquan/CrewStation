import type { ProjectDeletionContext, ProjectDeletionEvidence } from '@crewstation/contracts';
import type { OwnedInfrastructureContent } from '../domain/infrastructureContents';
import type { ProvisioningDeletionProofs, ProvisioningDeletionScope } from '../domain/projectDeletion';

export interface ProvisioningDeletionRepository {
  registered(): Promise<void>;
  bind(context: ProjectDeletionContext, scope: ProvisioningDeletionScope): Promise<void>;
  read(context: ProjectDeletionContext): Promise<{ readonly scope: ProvisioningDeletionScope; readonly proofs: ProvisioningDeletionProofs }>;
  record(context: ProjectDeletionContext, evidence: ProjectDeletionEvidence): Promise<void>;
  purgeCallbacks(context: ProjectDeletionContext): Promise<void>;
}
export interface InfrastructureContentRemoval { remove(contents: readonly OwnedInfrastructureContent[]): Promise<boolean> }
