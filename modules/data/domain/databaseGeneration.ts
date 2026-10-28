import type { DatabasePhysicalIdentity, DataEnv, ProjectId, ServiceId } from '@crewstation/contracts';
export interface DatabaseGeneration {
  id: string; resourceId: string; projectId: ProjectId; serviceId: ServiceId; env: DataEnv;
  objectName: string; credentialResourceId: string; secretBox: string | null;
  origin: 'existing' | 'restore' | 'migration' | 'migration-scratch'; migrationOperationId?: string | null; restoreOperationId: string | null; state: 'provisioning' | 'ready' | 'active' | 'retained';
  identity: DatabasePhysicalIdentity | null;
  emptyProof: { identity: DatabasePhysicalIdentity; operationId: string; observedAt: string; birthDigest: string } | null;
  createdAt: Date; updatedAt: Date;
}
export interface DatabaseEnvironmentBinding {
  resourceId: string; projectId: ProjectId; serviceId: ServiceId; env: DataEnv; generationId: string; revision: number;
  migrationOperationId?: string | null;
  restoreOperationId: string | null; lastRestoreOperationId: string | null; previousGenerationId: string | null;
}
export const sameDatabaseIdentity = (a: DatabasePhysicalIdentity, b: DatabasePhysicalIdentity): boolean => a.serverId === b.serverId && a.databaseOid === b.databaseOid && a.roleOid === b.roleOid;
export const restoreDatabaseName = (id: string): string => `cs_restore_${id.replaceAll('-', '')}`;
