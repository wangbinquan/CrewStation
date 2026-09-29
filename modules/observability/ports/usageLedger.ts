import type { RuntimeFactQuery, RuntimeTaskFact, RunnerUsageCapture, RuntimeNativeCapture } from '@crewstation/contracts';
import type { ExecutionObservationIdentity, RunnerUsageMeasurement, RunnerUsageSourceIdentity, RunnerUsageSourcePage } from '@crewstation/contracts';
import type { ExecutionUsageObservation, ExecutionObservation, ExecutionValuationObservation, ProjectId, TaskId, ExecutionCostVisibilityDto, SetExecutionCostVisibility } from '@crewstation/contracts';
import type { ActualPricingModel } from './tokenPricing';
import type { UsageEvidence } from '../domain/usageProjection';

export interface UsageTaskScope { projectId: ProjectId; taskId: TaskId }
export interface UsageSourcePage extends UsageTaskScope {
  sourceId: string; expectedCursor: string | null; nextCursor: string;
  events: Array<{ eventId: string; measurement: UsageEvidence }>;
  native?: Array<{ identity: ExecutionObservationIdentity; capture: RunnerUsageCapture }>;
}
export interface UsageLedgerTransaction {
  cursor(): Promise<string | null>;
  pageFingerprint(nextCursor: string): Promise<string | undefined>;
  eventFingerprint(eventId: string): Promise<string | undefined>;
  revisionFingerprint(measurement: UsageEvidence): Promise<string | undefined>;
  evidence(measurement: UsageEvidence, afterRevision: number, limit: number): Promise<UsageEvidence[]>;
  current(measurement: UsageEvidence): Promise<ExecutionUsageObservation | undefined>;
  append(event: UsageSourcePage['events'][number], fingerprint: string): Promise<void>;
  project(value: ExecutionUsageObservation): Promise<void>;
  capture(identity: ExecutionObservationIdentity, frame: RunnerUsageCapture): Promise<void>;
  advance(nextCursor: string, fingerprint: string): Promise<void>;
}
export interface UsageChanges {
  items: ExecutionObservation[]; captureIncomplete: boolean; nextCursor: number; persistedThrough: number; hasMore: boolean;
}
export interface UsageSnapshotQuery { snapshotId?: string; cursor?: string; limit: number }
export interface UsageSnapshot {
  snapshotId: string; snapshotThrough: number; expiresAt: number; createdAt: number; visibilityRevision: number;
  items: ExecutionObservation[]; captureIncomplete: boolean; nextCursor: string | null;
}
export interface UsageLedgerStore {
  snapshot(scope: UsageTaskScope, query: UsageSnapshotQuery, now: number, visibilityRevision: number): Promise<UsageSnapshot>;
  change<T>(scope: UsageTaskScope, sourceId: string, work: (tx: UsageLedgerTransaction) => Promise<T>): Promise<T>;
  cursor(scope: UsageTaskScope, sourceId: string): Promise<string | null>;
  changes(scope: UsageTaskScope, after: number, limit: number): Promise<UsageChanges>;
}

export interface ExecutionObservationCaller { identity: string; token?: string }
export interface ExecutionObservationAccess {
  task(caller: ExecutionObservationCaller, taskId: TaskId): Promise<UsageTaskScope>;
}
export interface ExecutionCostVisibilityStore {
  read(projectId: ProjectId): Promise<ExecutionCostVisibilityDto>;
  save(projectId: ProjectId, input: SetExecutionCostVisibility, now: Date): Promise<ExecutionCostVisibilityDto>;
}

export type UsageMeasurementRef = Pick<UsageEvidence, 'identity' | 'sourceId' | 'recordId'>;
/** Actual model evidence must come from the persisted runtime source, never a configured default. */
export interface ExecutionValuationRequest {
  measurement: UsageMeasurementRef; usageRevision: number; model: ActualPricingModel | null; requestKey: string;
}
export interface ExecutionValuationReceipt { fingerprint: string; document: ExecutionValuationObservation }
export interface ExecutionValuationStore {
  pendingNativeRepairs(scope: UsageTaskScope, limit: number): Promise<Array<{ usage: ExecutionUsageObservation; modelEvidence: RunnerUsageMeasurement | null }>>;
  usage(ref: UsageMeasurementRef): Promise<ExecutionUsageObservation | undefined>;
  receipt(scope: UsageTaskScope, requestKey: string): Promise<ExecutionValuationReceipt | undefined>;
  /** Compare the current usage revision, replace the valuation and append its sync change atomically. */
  commit(input: ExecutionValuationRequest, fingerprint: string, basisFingerprint: string, draft: ExecutionValuationObservation): Promise<ExecutionValuationObservation>;
}

/** Cross-owner operations are bound only by platform wiring. */
export interface RunnerUsageSource {
  next(): Promise<RunnerUsageSourcePage | undefined>;
  measurement(source: RunnerUsageSourceIdentity, recordId: string, revision: number): Promise<RunnerUsageMeasurement | undefined>;
  acknowledge(taskId: TaskId, executionId: string, through: number): Promise<void>;
  resolve(input: RunnerUsageSourceIdentity): Promise<ExecutionObservationIdentity | undefined>;
}


export interface RuntimeStatisticsSnapshot {
  tasks: RuntimeTaskFact[];
  observations: ExecutionObservation[];
  costVisible: Readonly<Record<string, boolean>>;
  nativeCaptures?: RuntimeNativeCapture[];
  partial: boolean;
}
export interface RuntimeStatisticsSource {
  read(query: RuntimeFactQuery): Promise<RuntimeStatisticsSnapshot>;
}
