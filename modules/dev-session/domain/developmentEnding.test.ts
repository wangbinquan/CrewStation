import { expect, test } from 'bun:test';
import { DevelopmentUsageReceiptSchema, DevelopmentUsageRegistrationSchema, StoredDevelopmentUsageSchema } from '@crewstation/contracts';
import { DevelopmentEndingJobSchema, DevelopmentEndingRequestSchema, developmentEndingDeadline, developmentEndingStored, mergeDevelopmentEnding } from './developmentEnding';

const id = (n: number) => '01a00000-0000-7000-8000-' + String(n).padStart(12, '0');
const registration = DevelopmentUsageRegistrationSchema.parse({ runtimeTaskId: id(3), key: { executionId: id(3), journalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', incarnation: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', payloadDigest: 'c'.repeat(64) },
  podUid: 'original-pod', identity: { sourceKind: 'development-agent', projectId: id(1), taskId: id(2), agentId: id(4), executionId: id(3), executionGeneration: 1 }, profileId: id(5), profileRevision: 2 });
const receipt = DevelopmentUsageReceiptSchema.parse({ key: registration.key, podUid: registration.podUid, identity: registration.identity, profileId: registration.profileId, profileRevision: 2,
  phase: 'finished', lastSequence: 10, acknowledgedSequence: 8, finalThrough: 10, result: 'completed', interruption: null });
const now = '2026-09-30T00:20:00.000Z';
const job = DevelopmentEndingJobSchema.parse({ executionTaskId: id(3), firstReason: 'cancelled', observedAt: now, actualEndedAt: null, logicalResult: null,
  version: 1, fence: 0, lastAttemptAt: now, leaseUntil: null, stop: null, closure: null, stage: 'awaiting-stop' });
const stored = StoredDevelopmentUsageSchema.parse({ registration, receipt, persistedThrough: 8, runnerAcknowledgedThrough: 8, sourceAcknowledgedThrough: 0, offeredThrough: 0,
  complete: false, drainReason: 'cancelled', loss: null, closure: null });
const stop = { version: 1 as const, state: 'finished' as const, receipt };
const closed = () => StoredDevelopmentUsageSchema.parse({ ...stored, persistedThrough: 10, complete: true,
  closure: { status: 'complete', persistedThrough: 10, reportedThrough: 10, missingAfter: null, missingThrough: null, tailUnknown: false, reason: null, closedAt: now } });

test('logical finished, physical stop and durable digital closure are three independent facts', () => {
  const logical = mergeDevelopmentEnding(job, registration, { observedAt: now, stored, stop: null });
  expect(logical).toMatchObject({ logicalResult: 'completed', actualEndedAt: null, stage: 'awaiting-stop', stop: null });
  const physical = mergeDevelopmentEnding(logical, registration, { observedAt: now, stored, stop });
  expect(physical.stage).toBe('awaiting-closure');
  const complete = mergeDevelopmentEnding(physical, registration, { observedAt: now, stored: closed(), stop });
  expect(complete).toMatchObject({ firstReason: 'cancelled', observedAt: now, actualEndedAt: null, logicalResult: 'completed', stage: 'evidence-complete' });
  expect(mergeDevelopmentEnding(complete, registration, { observedAt: now, stored: closed(), stop })).toEqual(complete);
  expect(mergeDevelopmentEnding(job, registration, { observedAt: now, stored: closed(), stop: null }).stage).toBe('awaiting-stop');
});
test('unknown interrupted finished never grants physical evidence; fabricated closure watermarks are rejected', () => {
  const interrupted = { ...receipt, finalThrough: null, interruption: 'runner-restarted' as const };
  expect(mergeDevelopmentEnding(job, registration, { observedAt: now, stored: { ...stored, receipt: interrupted }, stop: { version: 1, state: 'unknown', receipt: interrupted } })).toMatchObject({ stop: null, stage: 'awaiting-stop' });
  expect(() => mergeDevelopmentEnding(job, registration, { observedAt: now, stored: { ...closed(), persistedThrough: 8 }, stop })).toThrow();
  expect(() => mergeDevelopmentEnding(job, registration, { observedAt: now, stored: { ...closed(), drainReason: null }, stop })).toThrow();
});
test('every original key, Pod, identity and profile must match before ending evidence can be recorded', () => {
  for (const patch of [{ podUid: 'new-pod' }, { profileRevision: 3 }, { identity: { ...registration.identity, agentId: id(6) } }, { key: { ...registration.key, incarnation: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } }]) {
    expect(() => developmentEndingStored(registration, { ...stored, registration: { ...registration, ...patch } })).toThrow();
    expect(() => mergeDevelopmentEnding(job, registration, { observedAt: now, stored, stop: { ...stop, receipt: { ...receipt, ...patch } } })).toThrow();
  }
});
test('actual results and already durable closure cannot be substituted by later snapshots', () => {
  const complete = mergeDevelopmentEnding(job, registration, { observedAt: now, stored: closed(), stop });
  expect(() => mergeDevelopmentEnding(complete, registration, { observedAt: now, stored, stop: { ...stop, receipt: { ...receipt, result: 'error' } } })).toThrow();
  expect(() => mergeDevelopmentEnding(complete, registration, { observedAt: now, stored: { ...closed(), closure: { ...closed().closure!, closedAt: '2026-09-30T00:21:00.000Z' } }, stop })).toThrow();
  expect(() => mergeDevelopmentEnding(complete, registration, { observedAt: now, stored: closed(), stop: { ...stop, state: 'prevented', receipt: { ...receipt, result: 'cancelled' } } })).toThrow();
});
test('private schema refuses fabricated actual times, new identities, force strings, unsupported stages and missing terminal proof', () => {
  expect(DevelopmentEndingJobSchema.safeParse({ ...job, actualEndedAt: now }).success).toBe(false);
  expect(DevelopmentEndingJobSchema.safeParse({ ...job, stage: 'evidence-complete' }).success).toBe(false);
  expect(DevelopmentEndingJobSchema.safeParse({ ...job, arbitrary: true }).success).toBe(false);
  for (const reason of ['completed', 'error', 'forced-release', 'environment-lost']) expect(DevelopmentEndingRequestSchema.safeParse({ executionTaskId: registration.runtimeTaskId, expectedRegistration: registration, reason, observedAt: now }).success).toBe(false);
  expect(DevelopmentEndingRequestSchema.safeParse({ executionTaskId: id(6), expectedRegistration: registration, reason: 'cancelled', observedAt: now }).success).toBe(false);
  expect(DevelopmentEndingRequestSchema.safeParse({ executionTaskId: registration.runtimeTaskId, expectedRegistration: null, reason: 'cancelled', observedAt: now, receipt }).success).toBe(false);
  expect(developmentEndingDeadline('2026-09-30T00:20:00Z')).toBe('2026-09-30T00:20:30.000Z');
});
