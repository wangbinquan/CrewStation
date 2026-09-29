// RFC-034: public owner/client DTOs cannot turn unknown, reported or foreign data into copied proof.
import { expect, test } from 'bun:test';
import { ProjectIdSchema, ResourceIdSchema, TaskIdSchema } from '../ids';
import { DevelopmentUsageLossSchema, DevelopmentUsageRegistrationSchema, StoredDevelopmentUsageSchema } from '../taskrunner/developmentUsageStorage';
import type { StoredDevelopmentUsage } from '../taskrunner/developmentUsageStorage';

const at = '2026-09-30T06:00:00.000Z';
const registered = (): StoredDevelopmentUsage => {
  const executionId = TaskIdSchema.parse(Bun.randomUUIDv7());
  return { registration: { runtimeTaskId: executionId, key: { executionId, journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64) }, podUid: 'original-pod',
    identity: { sourceKind: 'development-agent', projectId: ProjectIdSchema.parse(Bun.randomUUIDv7()), taskId: TaskIdSchema.parse(Bun.randomUUIDv7()), executionId, executionGeneration: 1, agentId: ResourceIdSchema.parse(Bun.randomUUIDv7()) }, profileId: ResourceIdSchema.parse(Bun.randomUUIDv7()), profileRevision: 3 },
    receipt: null, persistedThrough: 0, runnerAcknowledgedThrough: 0, sourceAcknowledgedThrough: 0, offeredThrough: 0, complete: false, drainReason: null, loss: null, closure: null };
};
const copied = (): StoredDevelopmentUsage => {
  const s = registered(), { runtimeTaskId: _id, ...header } = s.registration;
  return { ...s, receipt: { ...header, phase: 'running', lastSequence: 10, acknowledgedSequence: 0, finalThrough: null, result: null, interruption: null }, persistedThrough: 8 };
};
const interrupted = (): StoredDevelopmentUsage => {
  const s = copied(); return { ...s, drainReason: 'environment-lost', loss: { key: s.registration.key, podUid: s.registration.podUid, reason: 'pod-lost' }, closure: { status: 'interrupted', persistedThrough: 8, reportedThrough: 10, missingAfter: 8, missingThrough: 10, tailUnknown: true, reason: 'pod-lost', closedAt: at } };
};

test('owner registration stays strict, execution-bound and free of prompt, nonce or secret material', () => {
  const s = registered(), r = s.registration;
  expect(StoredDevelopmentUsageSchema.parse(s)).toEqual(s);
  for (const patch of [{ runtimeTaskId: Bun.randomUUIDv7() }, { identity: { ...r.identity, executionId: Bun.randomUUIDv7() } }, { prompt: 'private' }, { digestNonce: 'a'.repeat(64) }, { secrets: {} }])
    expect(DevelopmentUsageRegistrationSchema.safeParse({ ...r, ...patch }).success).toBe(false);
});

test('reported N and Runner ACK cannot replace continuous copied M or offered/consumed outbox watermarks', () => {
  const s = copied(); expect(StoredDevelopmentUsageSchema.safeParse(s).success).toBe(true);
  for (const patch of [{ runnerAcknowledgedThrough: 9 }, { offeredThrough: 9 }, { sourceAcknowledgedThrough: 1 }, { offeredThrough: 5, sourceAcknowledgedThrough: 6 }, { persistedThrough: 11 }, { receipt: null }, { complete: true }, { receipt: { ...s.receipt, acknowledgedSequence: 1 } }])
    expect(StoredDevelopmentUsageSchema.safeParse({ ...s, ...patch }).success).toBe(false);
});

test('receipt and loss proofs preserve the original journal, Pod, owner and compute revision', () => {
  const s = copied();
  for (const patch of [{ key: { ...s.registration.key, journalId: crypto.randomUUID() } }, { podUid: 'replacement-pod' }, { identity: { ...s.registration.identity, taskId: Bun.randomUUIDv7() } }, { profileId: Bun.randomUUIDv7() }, { profileRevision: 4 }])
    expect(StoredDevelopmentUsageSchema.safeParse({ ...s, receipt: { ...s.receipt, ...patch } }).success).toBe(false);
  const loss = interrupted().loss!;
  expect(StoredDevelopmentUsageSchema.safeParse({ ...s, loss: { ...loss, key: s.registration.key, podUid: s.registration.podUid } }).success).toBe(true);
  for (const patch of [{ podUid: 'replacement-pod' }, { key: { ...s.registration.key, incarnation: crypto.randomUUID() } }])
    expect(StoredDevelopmentUsageSchema.safeParse({ ...s, loss: { ...loss, ...patch } }).success).toBe(false);
  expect(DevelopmentUsageLossSchema.safeParse({ ...loss, reason: 'timeout' }).success).toBe(false);
  expect(DevelopmentUsageLossSchema.safeParse({ ...loss, reason: 'pg-unavailable' }).success).toBe(false);
});

test('interrupted closure retains exact known gaps and requires an owner request plus actual loss proof', () => {
  const s = interrupted(); expect(StoredDevelopmentUsageSchema.safeParse(s).success).toBe(true);
  for (const patch of [{ drainReason: null }, { loss: null }]) expect(StoredDevelopmentUsageSchema.safeParse({ ...s, ...patch }).success).toBe(false);
  for (const patch of [{ persistedThrough: 10 }, { reportedThrough: 8 }, { missingAfter: null }, { missingThrough: null }, { tailUnknown: false }, { status: 'complete' }, { reason: 'journal-replaced' }])
    expect(StoredDevelopmentUsageSchema.safeParse({ ...s, closure: { ...s.closure, ...patch } }).success).toBe(false);
});

test('unknown tail remains open and an interrupted readable tail cannot close before it is copied', () => {
  const s = registered(), loss = { key: s.registration.key, podUid: s.registration.podUid, reason: 'workspace-released' as const };
  const closure = { status: 'interrupted' as const, persistedThrough: 0, reportedThrough: null, missingAfter: 0, missingThrough: null, tailUnknown: true, reason: 'workspace-released', closedAt: at };
  expect(StoredDevelopmentUsageSchema.safeParse({ ...s, drainReason: 'workspace-released', loss, closure }).success).toBe(true);
  const partial = interrupted(); partial.loss = null; partial.receipt!.interruption = 'journal-corrupt'; partial.closure!.reason = 'journal-corrupt';
  expect(StoredDevelopmentUsageSchema.safeParse(partial).success).toBe(false);
  partial.persistedThrough = 10; partial.closure!.persistedThrough = 10; partial.closure!.missingAfter = null; partial.closure!.missingThrough = null;
  expect(StoredDevelopmentUsageSchema.safeParse(partial).success).toBe(true);
  partial.loss = { key: partial.registration.key, podUid: partial.registration.podUid, reason: 'pod-lost' };
  expect(StoredDevelopmentUsageSchema.safeParse(partial).success).toBe(true);
});

test('complete zero is only a final transport receipt; stale numeric loss does not invent a gap', () => {
  const s = registered(), { runtimeTaskId: _id, ...header } = s.registration;
  const receipt = { ...header, phase: 'finished' as const, lastSequence: 0, acknowledgedSequence: 0, finalThrough: 0, result: 'completed' as const, interruption: null };
  const complete = { ...s, receipt, complete: true, drainReason: 'completed', closure: { status: 'complete', persistedThrough: 0, reportedThrough: 0, missingAfter: null, missingThrough: null, tailUnknown: false, reason: null, closedAt: at } };
  expect(StoredDevelopmentUsageSchema.safeParse(complete).success).toBe(true);
  expect(StoredDevelopmentUsageSchema.safeParse({ ...complete, closure: { ...complete.closure, reason: 'pod-lost' } }).success).toBe(false);
  expect(StoredDevelopmentUsageSchema.safeParse({ ...complete, loss: { key: s.registration.key, podUid: s.registration.podUid, reason: 'pod-lost' } }).success).toBe(true);
});
