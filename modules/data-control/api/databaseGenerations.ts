import type { DatabasePhysicalIdentity, ProjectId } from '@crewstation/contracts';
/** Independent physical observation. No credentials, application receipt or arbitrary connection string. */
export interface DatabaseGenerationInspector {
  inspect(input: { projectId: ProjectId; resourceId: string; databaseName: string }): Promise<{ identity: DatabasePhysicalIdentity; empty: boolean; birthDigest: string | null; provisioning: boolean } | null>;
}
