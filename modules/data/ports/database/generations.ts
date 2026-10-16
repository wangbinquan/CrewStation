import type { DataEnv, DatabasePhysicalIdentity, ProjectId, ServiceId } from '@crewstation/contracts';
import type { DataResource } from '../../domain/dataResource';
import type { DatabaseEnvironmentBinding, DatabaseGeneration } from '../../domain/databaseGeneration';
export interface DatabaseGenerations {
  ensureInitial(resource: DataResource): Promise<void>;
  active(serviceId: ServiceId, env: DataEnv): Promise<{ binding: DatabaseEnvironmentBinding; generation: DatabaseGeneration } | undefined>;
  get(id: string): Promise<DatabaseGeneration | undefined>;
  list(serviceId: ServiceId): Promise<DatabaseGeneration[]>;
  reserve(input: { id: string; operationId: string; serviceId: ServiceId; expectedGenerationId: string; expectedRevision: number }): Promise<DatabaseGeneration>;
  recordIdentity(id: string, identity: DatabasePhysicalIdentity, emptyProof?: NonNullable<DatabaseGeneration['emptyProof']>): Promise<void>;
  commit(input: { operationId: string; serviceId: ServiceId; sourceGenerationId: string; targetGenerationId: string; expectedRevision: number }): Promise<DatabaseEnvironmentBinding>;
  finish(serviceId: ServiceId, operationId: string): Promise<void>;
  assertUnreserved(serviceId: ServiceId): Promise<void>;
  withUnreserved<T>(serviceId: ServiceId, effect: () => Promise<T>): Promise<T>;
}
export interface DatabaseGenerationPlane {
  inspect(input: { projectId: ProjectId; resourceId: string; databaseName: string }): Promise<{ identity: DatabasePhysicalIdentity; empty: boolean; birthDigest: string | null; provisioning: boolean } | null>;
}
