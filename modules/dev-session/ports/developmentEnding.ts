import type { DevelopmentUsageDrainReason, DevelopmentUsageKey, DevelopmentUsageRegistration, RunnerCommand, StoredDevelopmentUsage, TaskId } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';
import type { DevelopmentUsageOwner } from './developmentUsage';
import type { DevelopmentEndingEvidence, DevelopmentEndingJob, DevelopmentEndingLease, DevelopmentEndingRequest } from '../domain/developmentEnding';
export type { DevelopmentEndingEvidence, DevelopmentEndingJob, DevelopmentEndingLease, DevelopmentEndingRequest } from '../domain/developmentEnding';

/** Owner-private evidence only; no operation in this port authorizes physical cleanup. */
export interface DevelopmentEndingStore {
  request(input: DevelopmentEndingRequest): Promise<DevelopmentEndingJob>;
  get(executionTaskId: TaskId): Promise<DevelopmentEndingJob | undefined>;
  listPending(now: string): Promise<TaskId[]>;
  claim(executionTaskId: TaskId, now: string): Promise<DevelopmentEndingLease | undefined>;
  commit(lease: DevelopmentEndingLease, evidence: DevelopmentEndingEvidence): Promise<DevelopmentEndingJob | undefined>;
  retry(lease: DevelopmentEndingLease, now: string): Promise<boolean>;
  takeRecoveryOwners(now: string): Promise<TaskId[]>;
}
export interface DevelopmentEndingSession {
  registerDevelopmentUsage(registration: DevelopmentUsageRegistration): Promise<StoredDevelopmentUsage>;
  requestDevelopmentUsageDrain(taskId: TaskId, key: DevelopmentUsageKey, reason: DevelopmentUsageDrainReason): Promise<StoredDevelopmentUsage>;
  sendCommand(taskId: TaskId, command: RunnerCommand): Promise<unknown>;
}
export interface DevelopmentEndingDeps {
  clock: Clock;
  owner: Pick<DevelopmentUsageOwner, 'get'>;
  store: DevelopmentEndingStore;
  session: DevelopmentEndingSession;
}
