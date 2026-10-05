import type { DeleteStoredObject, ObjectReferenceInput } from '@crewstation/contracts';
import type { ObjectReadTransfer, ObjectSource, StoredObjectRecord } from '../domain/objectStorage';
import type { UploadAuthority } from './objectStorage';

export interface ObjectContentRepository {
  /** Trusted own read authority before durable admission; the callback includes response and metadata finalization. */
  withRead?<T>(id: string, source: ObjectSource, effect: () => Promise<T>): Promise<T>;
  reference(id: string, input: ObjectReferenceInput, desired: 'active' | 'released', authority: UploadAuthority): Promise<StoredObjectRecord>;
  delete(id: string, input: DeleteStoredObject, authority: UploadAuthority): Promise<StoredObjectRecord>;
  acquireRead(id: string, transferId: string, owner: string, source: ObjectSource): Promise<{ object: StoredObjectRecord; transfer: ObjectReadTransfer }>;
  releaseRead(id: string, owner: string): Promise<boolean>;
  markDegraded(id: string, reason: string): Promise<void>;
  claimDelete(owner: string): Promise<StoredObjectRecord | undefined>;
  completeDelete(claim: StoredObjectRecord): Promise<boolean>;
  failDelete(claim: StoredObjectRecord, errorCode: string): Promise<boolean>;
}
