import type { Actor, DataEnv, DatabaseBindingDto, DatabaseGenerationDto, DatabaseGenerationList, DatabasePhysicalIdentity, ServiceId } from '@crewstation/contracts';
export interface DatabaseGenerationApi {
  list(actor: Actor, serviceId: ServiceId): Promise<DatabaseGenerationList>;
  active(serviceId: ServiceId, env: DataEnv): Promise<DatabaseBindingDto>;
  reserve(input: { id: string; operationId: string; serviceId: ServiceId; expectedGenerationId: string; expectedRevision: number }): Promise<DatabaseGenerationDto>;
  prepare(serviceId: ServiceId, operationId: string, generationId: string): Promise<{ ready: boolean; identity: DatabasePhysicalIdentity | null }>;
  envFor(serviceId: ServiceId, generationId: string, operationId?: string): Promise<Record<string, string>>;
  commit(input: { operationId: string; serviceId: ServiceId; sourceGenerationId: string; targetGenerationId: string; expectedRevision: number }): Promise<DatabaseBindingDto>;
  finish(serviceId: ServiceId, operationId: string): Promise<void>;
  assertUnreserved(serviceId: ServiceId): Promise<void>;
}
