import type { ObjectAttemptRecord } from '../domain/objectStorage';

export interface ObjectRecoveryRepository {
  claimInspection(owner: string): Promise<ObjectAttemptRecord | undefined>;
  inspected(claim: ObjectAttemptRecord): Promise<boolean>;
  deferInspection(claim: ObjectAttemptRecord): Promise<boolean>;
  expireIdle(): Promise<number>;
  claimGarbage(owner: string): Promise<ObjectAttemptRecord | undefined>;
  completeGarbage(claim: ObjectAttemptRecord): Promise<boolean>;
  failGarbage(claim: ObjectAttemptRecord): Promise<boolean>;
}
