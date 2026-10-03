import type { DevelopmentParentEndingRepository, DevelopmentParentEndingChildren, DevelopmentParentEndingObjects, DevelopmentParentRebuildClaims } from './developmentParentEnding';

export interface DevelopmentParentEndingJobLease { readonly jobId: number; readonly fencingToken: number }
export interface DevelopmentParentRecoveryCandidate { readonly kind: 'ending' | 'rebuild'; readonly requestId: string }
/** Only a real UnitOfWork transaction can retain either authorization until final commit. */
export interface DevelopmentParentEndingScope {
  readonly recovery: {
    /** Global cursor transaction only; publish each returned original in its own project admission after this commit. */
    scan(cutoff: Date, limit?: number): Promise<DevelopmentParentRecoveryCandidate[]>;
    /** Legacy installations without project callback admission keep their original atomic refill. */
    refill(cutoff: Date, limit?: number): Promise<number>;
  };
  readonly endings: DevelopmentParentEndingRepository;
  readonly children: DevelopmentParentEndingChildren;
  readonly objects: DevelopmentParentEndingObjects;
  readonly claims: DevelopmentParentRebuildClaims;
  readonly queue: { enqueue(endingId: string): Promise<void> };
  readonly lease: { requireCurrent(identity: DevelopmentParentEndingJobLease, endingId: string): Promise<void> };
  readonly rebuildLease: { requireCurrent(identity: DevelopmentParentEndingJobLease, requestId: string): Promise<void> };
}
