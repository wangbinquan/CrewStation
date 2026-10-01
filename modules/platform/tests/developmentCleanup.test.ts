// RFC-034 composition guard; full persistence and physical chain are tested under root E2E.
import { describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { ProjectIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { developmentCleanupPort } from '../application/developmentCleanupPorts';
import type { DevelopmentCleanupEvidence, DevelopmentCleanupSelection } from '../ports/developmentCleanup';

function values() {
  const s: DevelopmentCleanupSelection = { version: 1, identity: { sourceKind: 'development-agent', executionGeneration: 1, projectId: ProjectIdSchema.parse(newResourceId()),
    taskId: TaskIdSchema.parse(newResourceId()), agentId: newResourceId(), executionId: newResourceId() }, profileId: newResourceId(), profileRevision: 2,
    podUid: crypto.randomUUID(), consumerId: newResourceId(), renderStart: 1, selectionHash: 'a'.repeat(64) };
  const key = { executionId: s.identity.executionId, journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), payloadDigest: 'b'.repeat(64) };
  const evidence: DevelopmentCleanupEvidence = { version: 1, selection: s, registration: { key, identity: { ...s.identity, sourceKind: 'development-agent', executionGeneration: 1 },
    runtimeTaskId: TaskIdSchema.parse(key.executionId), podUid: s.podUid, profileId: s.profileId, profileRevision: s.profileRevision },
    stop: { version: 1, state: 'finished', receipt: { key, identity: { ...s.identity, sourceKind: 'development-agent', executionGeneration: 1 }, podUid: s.podUid,
      profileId: s.profileId, profileRevision: 2, phase: 'finished', result: 'cancelled', lastSequence: 0, acknowledgedSequence: 0, finalThrough: 0, interruption: null } },
    closure: { status: 'complete', persistedThrough: 0, reportedThrough: 0, missingAfter: null, missingThrough: null, tailUnknown: false, reason: null, closedAt: '2026-10-01T00:00:00.000Z' },
    owner: { payloadDigest: key.payloadDigest, firstReason: 'cancelled', acceptedAt: '2026-09-30T00:00:00.000Z', profileId: s.profileId, profileRevision: 2, protocol: 'opencode', priceBookRevision: 3 } };
  return { s, evidence };
}
describe('RFC-034 explicit Task-to-Dev cleanup composition', () => {
  test('exact current selection reaches owner and preserves its irreversible evidence', async () => {
    const { s, evidence } = values(); let calls = 0;
    const p = developmentCleanupPort({ inspectDevelopmentCleanupSelection: async () => s }, { advance: async () => { calls++; return { kind: 'permitted', evidence }; } });
    expect(await p.advance(s)).toEqual({ kind: 'permitted', evidence }); expect(calls).toBe(1);
  });
  test('missing current query or changed selection waits without contacting digital owner', async () => {
    const { s } = values(); let calls = 0; const owner = { advance: async () => { calls++; return { kind: 'waiting' as const, reason: 'copy' }; } };
    for (const task of [{}, { inspectDevelopmentCleanupSelection: async () => ({ ...s, renderStart: 2 }) }, { inspectDevelopmentCleanupSelection: async () => undefined }]) {
      expect(await developmentCleanupPort(task, owner).advance(s)).toEqual({ kind: 'waiting', reason: 'task-selection' });
    }
    expect(calls).toBe(0);
  });
  test('a pending owner is retained but a foreign owner evidence cannot pass composition', async () => {
    const { s, evidence } = values(), task = { inspectDevelopmentCleanupSelection: async () => s };
    expect(await developmentCleanupPort(task, { advance: async () => ({ kind: 'waiting', reason: 'durable-copy' }) }).advance(s)).toEqual({ kind: 'waiting', reason: 'durable-copy' });
    await expect(developmentCleanupPort(task, { advance: async () => ({ kind: 'permitted', evidence: { ...evidence, selection: { ...s, selectionHash: 'c'.repeat(64) } } }) }).advance(s)).rejects.toMatchObject({ kind: 'precondition' });
  });
});
