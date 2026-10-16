import type { DatabaseBindingDto, DatabaseGenerationDto, DatabaseGenerationList, DatabasePhysicalIdentity, Actor, ServiceId } from '@crewstation/contracts';
import type { DatabaseRestoreOperation, RestoreJobProof } from '../domain/databaseRestore';
export interface DatabaseRestoreRepository {
  get(id: string): Promise<DatabaseRestoreOperation | undefined>;
  forJob(id: string): Promise<DatabaseRestoreOperation | undefined>;
  /** The service's unfinished operation (not completed and not abandoned), if any. */
  active(serviceId: ServiceId): Promise<DatabaseRestoreOperation | undefined>;
  list(serviceId: ServiceId): Promise<DatabaseRestoreOperation[]>;
  pending(limit: number, afterId?: string): Promise<DatabaseRestoreOperation[]>;
  insert(op: DatabaseRestoreOperation): Promise<void>;
  save(original: DatabaseRestoreOperation, next: DatabaseRestoreOperation): Promise<void>;
}
export interface DatabaseRestoreCoordination {
  run<T>(id: string, effect: () => Promise<T>): Promise<T>;
  assertAvailable(serviceId: ServiceId, operationId?: string): Promise<void>;
}
/** Reverse data-owner port. No release code accesses data tables. */
export interface RestoreDatabaseOwner {
  list(actor: Actor, serviceId: ServiceId): Promise<DatabaseGenerationList>;
  active(serviceId: ServiceId, env: 'production' | 'development'): Promise<DatabaseBindingDto>;
  reserve(input: { id: string; operationId: string; serviceId: ServiceId; expectedGenerationId: string; expectedRevision: number }): Promise<DatabaseGenerationDto>;
  prepare(serviceId: ServiceId, operationId: string, id: string): Promise<{ ready: boolean; identity: DatabasePhysicalIdentity | null }>;
  envFor(serviceId: ServiceId, id: string, operationId?: string): Promise<Record<string,string>>;
  commit(input: { operationId: string; serviceId: ServiceId; sourceGenerationId: string; targetGenerationId: string; expectedRevision: number }): Promise<DatabaseBindingDto>;
  finish(serviceId: ServiceId, operationId: string): Promise<void>;
  /** Ends an uncommitted reservation and retains the target database for inspection; idempotent. */
  abandon(serviceId: ServiceId, operationId: string): Promise<void>;
  assertUnreserved(serviceId: ServiceId): Promise<void>;
}
export interface RestoreJobObserver {
  candidate(input: {namespace:string;serviceName:string;physical:'blue'|'green';releaseId:string;revision:number;image:string;environment:Readonly<Record<string,string>>}): Promise<{deploymentUid:string;secretUid:string;environmentDigest:string}|null>;
  /** Terminal observations are explicit failed attempts (named `failure`) so the same operation can open a new attempt. */
  observe(input: { namespace: string; name: string; jobId: string; purpose: 'database-restore' | 'database-verify'; image: string; command: readonly string[]; target: DatabasePhysicalIdentity; environment: Readonly<Record<string,string>>; previous: RestoreJobProof | null }): Promise<RestoreJobProof | null>;
}
export interface DatabaseRestoreSupport {
  coordination: DatabaseRestoreCoordination;
  jobs: RestoreJobObserver;
  objectReadUrl: string;
  encrypt(value: string): Promise<string>;
  decrypt(value: string): Promise<string>;
  token(jobId: string, requestDigest: string): string;
  isAdmin(actorId: Actor['userId']): Promise<boolean>;
}
