import type { DevelopmentParentEndingRepository, DevelopmentParentEndingChildren, DevelopmentParentEndingObjects, DevelopmentParentRebuildClaims } from './developmentParentEnding';

export interface DevelopmentParentEndingJobLease { readonly jobId: number; readonly fencingToken: number }
/** Only a real UnitOfWork transaction can retain either authorization until final commit. */
export interface DevelopmentParentEndingScope {
  readonly recovery: { refill(cutoff: Date, limit?: number): Promise<number> };
  readonly endings: DevelopmentParentEndingRepository;
  readonly children: DevelopmentParentEndingChildren;
  readonly objects: DevelopmentParentEndingObjects;
  readonly claims: DevelopmentParentRebuildClaims;
  readonly queue: { enqueue(endingId: string): Promise<void> };
  readonly lease: { requireCurrent(identity: DevelopmentParentEndingJobLease, endingId: string): Promise<void> };
  readonly rebuildLease: { requireCurrent(identity: DevelopmentParentEndingJobLease, requestId: string): Promise<void> };
}
