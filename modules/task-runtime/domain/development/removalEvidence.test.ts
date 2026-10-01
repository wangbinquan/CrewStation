// RFC-034: a final token rotation preserves only the original, independently validated digital receipt.
import { expect, test } from 'bun:test';
import { ProjectIdSchema, ServiceIdSchema, TaskIdSchema, TraceIdSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { TaskEnvironment } from '../taskEnvironment';
import { DevelopmentCleanupEvidenceSchema } from './cleanupEvidence';
import { developmentCleanupSelection } from './cleanupSelection';
import { createDevelopmentRemovalSeal, requireDevelopmentRemovalEvidence } from './removalEvidence';

function fixture() {
  const profile = { id: newResourceId(), name: 'original', cpu: '1', memory: '2Gi', storage: '10Gi' };
  const env: TaskEnvironment = { id: TaskIdSchema.parse(newResourceId()), projectId: ProjectIdSchema.parse(newResourceId()),
    serviceId: ServiceIdSchema.parse(newResourceId()), kind: 'dev-session', state: 'releasing', volumeMode: 'persistent', profile: profile.id,
    namespace: 'cs-original', podName: 'task-original', pvcName: 'work-original', traceId: TraceIdSchema.parse('a'.repeat(32)),
    runnerTokenHash: 'b'.repeat(64), connected: true, labels: {}, createdAt: new Date(), updatedAt: new Date(), lastActivityAt: new Date(),
    render: { image: 'task:original', workerUid: 10001, resources: { cpu: profile.cpu, memory: profile.memory, storage: profile.storage }, start: 1,
      developmentUsageStorage: { version: 1 }, developmentUsageProtection: { version: 1 }, developmentRemovalProtection: { version: 1 }, workloadConsumerId: newResourceId() },
    native: { purpose: 'agent', parentTaskId: TaskIdSchema.parse(newResourceId()), parentPodUid: crypto.randomUUID(), pvcUid: crypto.randomUUID(), nodeName: 'node-original',
      agentId: newResourceId(), runnerId: crypto.randomUUID(), fingerprint: 'c'.repeat(64), requestedProfile: null, profile, image: 'task:original',
      computeProfile: { profileId: profile.id, revision: 3 }, state: 'cleaning', podUid: crypto.randomUUID(), secretUid: crypto.randomUUID() } };
  const selection = developmentCleanupSelection(env)!;
  const key = { executionId: env.id, journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), payloadDigest: 'd'.repeat(64) };
  const registration = { key, runtimeTaskId: env.id, podUid: selection.podUid, identity: selection.identity, profileId: selection.profileId, profileRevision: selection.profileRevision };
  const evidence = DevelopmentCleanupEvidenceSchema.parse({ version: 1, selection, registration,
    stop: { version: 1, state: 'finished', receipt: { key, podUid: selection.podUid, identity: selection.identity,
      profileId: selection.profileId, profileRevision: selection.profileRevision, phase: 'finished', result: 'cancelled',
      lastSequence: 10, acknowledgedSequence: 10, finalThrough: 10, interruption: null } },
    closure: { status: 'complete', persistedThrough: 10, reportedThrough: 10, missingAfter: null, missingThrough: null, tailUnknown: false, reason: null, closedAt: '2026-10-01T00:00:00.000Z' },
    owner: { payloadDigest: key.payloadDigest, firstReason: 'cancelled', acceptedAt: '2026-10-01T00:00:00.000Z', profileId: selection.profileId, profileRevision: selection.profileRevision, protocol: 'opencode', priceBookRevision: 3 } });
  return { ...env, native: { ...env.native!, developmentCleanup: evidence } };
}

test('finished receipt validates the original hash after rotation and preserves the exact known interrupted tail', () => {
  const env = fixture(), seal = createDevelopmentRemovalSeal(env);
  const finished: TaskEnvironment = { ...env, state: 'released', runnerTokenHash: 'e'.repeat(64), native: { ...env.native!, state: 'finished', developmentRemovalSeal: seal } };
  expect(requireDevelopmentRemovalEvidence(finished).selection).toEqual(developmentCleanupSelection(env)!);
  expect(requireDevelopmentRemovalEvidence(finished).original.runnerTokenHash).toBe(env.runnerTokenHash);
  const raw = env.native!.developmentCleanup!;
  const interrupted = { ...env, native: { ...env.native!, developmentCleanup: DevelopmentCleanupEvidenceSchema.parse({ ...raw,
    stop: { ...raw.stop, receipt: { ...raw.stop.receipt, acknowledgedSequence: 5 } },
    closure: { ...raw.closure, status: 'interrupted', persistedThrough: 5, missingAfter: 5, missingThrough: 10, tailUnknown: true, reason: 'journal-unavailable' } }) } };
  expect(requireDevelopmentRemovalEvidence(interrupted).evidence.closure).toMatchObject({ persistedThrough: 5, reportedThrough: 10, missingAfter: 5, missingThrough: 10, tailUnknown: true });
  expect(createDevelopmentRemovalSeal(interrupted).selectionHash).toBe(seal.selectionHash);
});

test('missing or forged finished seal, changed immutable selection and still-live state never authorize deletion', () => {
  const env = fixture(), seal = createDevelopmentRemovalSeal(env);
  const finished: TaskEnvironment = { ...env, state: 'failed', runnerTokenHash: 'e'.repeat(64), native: { ...env.native!, state: 'finished', developmentRemovalSeal: seal } };
  for (const bad of [undefined, null, {}, { ...seal, version: 2 }, { ...seal, originalRunnerTokenHash: 'f'.repeat(64) },
    { ...seal, selectionHash: 'f'.repeat(64) }, { ...seal, extra: true }]) {
    expect(() => requireDevelopmentRemovalEvidence({ ...finished, native: { ...finished.native!, developmentRemovalSeal: bad } } as TaskEnvironment)).toThrow();
  }
  for (const patch of [{ state: 'running' as const }, { projectId: ProjectIdSchema.parse(newResourceId()) },
    { render: { ...env.render!, start: 2 } }, { native: { ...finished.native!, secretUid: crypto.randomUUID() } }]) {
    expect(() => requireDevelopmentRemovalEvidence({ ...finished, ...patch })).toThrow();
  }
  expect(() => requireDevelopmentRemovalEvidence({ ...env, native: { ...env.native!, developmentCleanup: undefined } })).toThrow();
  expect(() => requireDevelopmentRemovalEvidence({ ...env, state: 'running' })).toThrow();
  for (const bad of [null, false, 0, {}, { version: 2 }]) {
    expect(() => requireDevelopmentRemovalEvidence({ ...env, render: { ...env.render!, developmentRemovalProtection: bad } } as TaskEnvironment)).toThrow();
  }
});
