import type { ProjectId, TaskId } from '@crewstation/contracts';
import type { DevelopmentParentEpoch, DevelopmentParentEndingPointer } from '../domain/development/parentEnding';
import type { DevelopmentParentRetentionTransition } from '../domain/development/parentCompletion';

export const DEVELOPMENT_PARENT_ENDING_JOB_KIND = 'task-runtime.development-parent-ending';
export type DevelopmentParentEndingOperation = 'release' | 'rebuild' | 'retention' | 'compensation';
export interface DevelopmentParentEndingIdentity {
  readonly id: string;
  readonly parentId: TaskId;
  readonly projectId: ProjectId;
  readonly operation: DevelopmentParentEndingOperation;
  readonly epoch: DevelopmentParentEpoch;
  readonly epochHash: string;
  readonly selectionHash: string;
  readonly intent: Readonly<Record<string, unknown>>;
}
export interface DevelopmentParentEnding extends DevelopmentParentEndingIdentity {
  readonly phase: DevelopmentParentEndingPointer['phase'];
  readonly status: 'pending' | 'blocked' | 'complete';
  readonly membershipRevision: 1;
  readonly memberCount: number;
  readonly membershipFrozen: true;
  readonly afterChildId: string | null;
  readonly progress: Readonly<Record<string, unknown>>;
  readonly completionWitness: Readonly<Record<string, unknown>> | null;
  readonly message: string | null;
  readonly retryAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export interface DevelopmentParentEndingChild {
  readonly endingId: string;
  readonly childId: TaskId;
  readonly originalParentPodUid: string | null;
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly closed: boolean;
  readonly closure: Readonly<Record<string, unknown>> | null;
}
export interface DevelopmentParentEndingObject {
  readonly endingId: string;
  readonly kind: 'Pod' | 'Secret';
  readonly namespace: string;
  readonly name: string;
  readonly uid: string;
  readonly materialsHash: string;
  readonly absence: Readonly<Record<string, unknown>> | null;
}
export interface DevelopmentParentRebuildClaim {
  readonly sourceEndingId: string;
  readonly currentRebuildId: string;
  readonly revision: number;
  readonly afterTransitionHash: string;
  readonly state: 'pending' | 'published' | 'released';
  readonly retryAt: Date;
}
export interface DevelopmentParentEndingRepository {
  get(id: string, lock?: boolean): Promise<DevelopmentParentEnding | undefined>;
  active(parentId: TaskId, epochHash: string): Promise<DevelopmentParentEnding | undefined>;
  /** The owning project transaction freezes every accepted child with INSERT SELECT, never a bounded JS list. */
  admit(identity: DevelopmentParentEndingIdentity, now: Date): Promise<DevelopmentParentEnding>;
  /** Only mutable progress; identity, intent and frozen membership cannot be replaced. */
  progress(id: string, expected: DevelopmentParentEndingPointer['phase'], next: Pick<DevelopmentParentEnding, 'phase' | 'status' | 'afterChildId' | 'progress' | 'completionWitness' | 'message' | 'retryAt'>, now: Date): Promise<boolean>;
  /** Append only the strict legal D9 successor on an immutable complete source, within the Task transaction. */
  recordRetentionTransition?(source: Pick<DevelopmentParentEnding, 'id' | 'parentId' | 'projectId' | 'epochHash' | 'completionWitness'>, receipt: DevelopmentParentRetentionTransition): Promise<boolean>;
  due(afterId: string | null, cutoff: Date, limit: number): Promise<string[]>;
}
export interface DevelopmentParentEndingChildren {
  page(endingId: string, afterId?: string): Promise<DevelopmentParentEndingChild[]>;
  remaining(endingId: string): Promise<number>;
  liveUnfinished(endingId: string): Promise<number>;
  summary(endingId: string): Promise<{ readonly count: number; readonly closed: number; readonly digest: string }>;
  close(endingId: string, childId: TaskId, closure: Readonly<Record<string, unknown>>): Promise<boolean>;
}
export interface DevelopmentParentEndingObjects {
  insert(object: Omit<DevelopmentParentEndingObject, 'absence'>): Promise<void>;
  list(endingId: string): Promise<DevelopmentParentEndingObject[]>;
  matches(kind: 'Pod' | 'Secret', namespace: string, name: string): Promise<DevelopmentParentEndingObject[]>;
  absent(object: Omit<DevelopmentParentEndingObject, 'absence'>, witness: Readonly<Record<string, unknown>>): Promise<boolean>;
}
export interface DevelopmentParentRebuildClaims {
  get(sourceEndingId: string, lock?: boolean): Promise<DevelopmentParentRebuildClaim | undefined>;
  byRequest(currentRebuildId: string): Promise<DevelopmentParentRebuildClaim | undefined>;
  insert(claim: DevelopmentParentRebuildClaim): Promise<boolean>;
  /** Call under project/job fences; published sources cannot be handed off. */
  replace(expected: DevelopmentParentRebuildClaim, next: DevelopmentParentRebuildClaim): Promise<boolean>;
  publish(expected: DevelopmentParentRebuildClaim): Promise<boolean>;
  retry(expected: DevelopmentParentRebuildClaim, retryAt: Date): Promise<boolean>;
  due(afterId: string | null, cutoff: Date, limit: number): Promise<DevelopmentParentRebuildClaim[]>;
}
