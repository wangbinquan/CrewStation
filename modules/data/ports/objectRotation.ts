import type { UserId } from '@crewstation/contracts';
import type { ObjectBackendRecord } from '../domain/objectStorage';

export interface ObjectCredentialRotationRecord {
  readonly backendId: string; readonly requestKey: string; readonly digest: string;
  readonly actorId: UserId; readonly reason: string; readonly createdAt: string; readonly backend: ObjectBackendRecord;
}
/** Both metadata and the encrypted endpoint swap commit in one local PG transaction; no byte I/O here. */
export interface ObjectCredentialRotations {
  get(backendId: string, requestKey: string): Promise<ObjectCredentialRotationRecord | undefined>;
  commit(input: Omit<ObjectCredentialRotationRecord, 'backend' | 'createdAt'> & { expectedRevision: number }, apply: (transaction: object, credentialRevision: number) => Promise<void>): Promise<ObjectBackendRecord>;
}
