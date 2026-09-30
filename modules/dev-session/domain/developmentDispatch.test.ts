// RFC-034: an original durable receipt recovers logical state; it never proves process exit or zero usage.
import { expect, test } from 'bun:test';
import type { DevelopmentUsageReceipt } from '@crewstation/contracts';
import { DevelopmentStartIntentSchema, DevelopmentUsageReceiptSchema, ProjectIdSchema, ServiceIdSchema, StartAgentCommandSchema, TaskIdSchema, TraceIdSchema } from '@crewstation/contracts';
import { DevelopmentUsageOwnerRecordSchema, developmentOwnerIntentDigest } from './developmentUsage';
import { developmentCapabilitiesSupported, developmentDispatchCommand, developmentInfoDecision, developmentReceiptDecision, developmentReceiptMatches } from './developmentDispatch';

const id = (n: number) => '019f0000-0000-7000-8000-' + String(n).padStart(12, '0');
const intent = DevelopmentStartIntentSchema.parse({ version: 1, identity: { sourceKind: 'development-agent', projectId: ProjectIdSchema.parse(id(1)), taskId: TaskIdSchema.parse(id(2)), executionId: id(3), executionGeneration: 1, agentId: id(4) },
  profileId: id(5), profileRevision: 2, launch: { protocol: 'opencode', binaryPath: '/bin/opencode' }, permission: 'full', mode: 'interactive',
  initialPrompt: 'original-private-prompt', cwd: '/work', resumeSessionId: 'original-root', systemPrompt: null, mcp: [{ name: 'platform', url: 'http://mcp.test/' }], nativeUsageLineageKey: 'original-source', nativeSource: { version: 1 } });
const digestNonce = 'a'.repeat(64), payloadDigest = developmentOwnerIntentDigest({ intent, digestNonce });
const registration = { runtimeTaskId: TaskIdSchema.parse(id(3)), key: { executionId: id(3), journalId: '2df8e781-61f9-40ce-a9ba-b2b470ad64b0', incarnation: '7c8d69dc-ccf9-4f85-9f54-dd0c1c1bc944', payloadDigest },
  podUid: 'original-pod-uid', identity: intent.identity, profileId: intent.profileId, profileRevision: 2 };
const original = DevelopmentUsageOwnerRecordSchema.parse({ intent, digestNonce, payloadDigest, binding: registration, unsupported: false, closeReason: null,
  context: { serviceId: ServiceIdSchema.parse(id(6)), traceId: TraceIdSchema.parse('a'.repeat(32)), branch: 'main' },
  price: { identity: intent.identity, profile: { id: intent.profileId, revision: 2, protocol: 'opencode' }, acceptedAt: '2026-09-30T00:00:00.000Z', priceBookRevision: 3 } });
const receipt = (patch: Partial<DevelopmentUsageReceipt> = {}) => DevelopmentUsageReceiptSchema.parse({ key: registration.key, podUid: registration.podUid, identity: registration.identity, profileId: registration.profileId, profileRevision: registration.profileRevision, phase: 'running', lastSequence: 8, acknowledgedSequence: 0, finalThrough: null, result: null, interruption: null, ...patch });
function command() {
  return StartAgentCommandSchema.parse({ id: 'start', type: 'startAgent', agentId: intent.identity.agentId, compute: 'Original name', profileRevision: 2, launch: intent.launch, permission: intent.permission,
    mode: intent.mode, initialPrompt: intent.initialPrompt, cwd: intent.cwd, resumeSessionId: intent.resumeSessionId, mcp: intent.mcp.map((m) => ({ ...m, headers: { authorization: 'temporary-signed-token' } })), env: { TEMP: 'secret' },
    beforeStart: { profile: intent.profileId, revision: 2, contentHash: 'original-template', steps: [], vars: {}, secrets: {}, configFile: { kind: 'none' } }, processAttemptId: intent.identity.agentId + ':1' });
}

test('only a healthy empty ORIGINAL incarnation permits dispatch; restart restores the original durable key', () => {
  const info = { version: 1, runtimeTaskId: registration.runtimeTaskId, podUid: registration.podUid, journalId: registration.key.journalId, incarnation: registration.key.incarnation, receipt: null };
  expect(developmentInfoDecision(registration, info)).toEqual({ kind: 'empty' });
  for (const patch of [{ runtimeTaskId: id(9) }, { podUid: 'replacement' }, { journalId: crypto.randomUUID() }, { incarnation: crypto.randomUUID() }, { receipt: { invalid: true } }, { unexpected: true }])
    expect(developmentInfoDecision(registration, { ...info, ...patch }).kind).toBe('waiting');
  expect(developmentInfoDecision(registration, { ...info, incarnation: crypto.randomUUID(), receipt: receipt() })).toEqual({ kind: 'accepted', receipt: receipt() });
  expect(developmentReceiptDecision(registration, receipt({ phase: 'registered' })).kind).toBe('accepted');
});

test('logical finished and interrupted finished retain unknown actual time; unknown receipt cannot stop or restart', () => {
  for (const result of ['completed', 'error', 'cancelled'] as const) for (const interruption of [null, 'runner-restarted'] as const) {
    const finished = receipt({ phase: 'finished', result, interruption, finalThrough: interruption ? null : 8 });
    expect(developmentReceiptDecision(registration, finished)).toEqual({ kind: 'terminal', receipt: finished, actualEndedAt: null });
  }
  expect(developmentReceiptDecision(registration, receipt({ phase: 'unknown', interruption: 'runner-restarted' }))).toEqual({ kind: 'waiting', reason: 'source-unavailable' });
});

test('every original key, actual Pod, full identity and profile field must independently match', () => {
  const current = receipt();
  for (const patch of [{ key: { ...current.key, payloadDigest: 'b'.repeat(64) } }, { key: { ...current.key, journalId: crypto.randomUUID() } }, { key: { ...current.key, incarnation: crypto.randomUUID() } },
    { podUid: 'other-pod' }, { identity: { ...current.identity, projectId: id(10) } }, { identity: { ...current.identity, taskId: id(11) } }, { identity: { ...current.identity, agentId: id(12) } },
    { profileId: id(13) }, { profileRevision: 99 }, { phase: 'finished', result: null }, { extra: true }]) {
    expect(developmentReceiptMatches(registration, { ...current, ...patch })).toBe(false);
    expect(developmentReceiptDecision(registration, { ...current, ...patch }).kind).toBe('waiting');
  }
});

test('selected original source requires persistent stop and actual native capabilities; omission stays explicit unsupported', () => {
  const caps = { protocols: ['opencode' as const], pty: true, preview: false, developmentUsageV1: 1 as const, developmentUsageStopV1: 1 as const, usageObservationsV1: 1 as const, developmentNativeSourceV1: 1 as const, nativeUsageTreeV1: 1 as const };
  expect(developmentCapabilitiesSupported(original, caps)).toBe(true);
  for (const key of ['developmentUsageV1', 'developmentUsageStopV1', 'usageObservationsV1', 'developmentNativeSourceV1', 'nativeUsageTreeV1'] as const)
    expect(developmentCapabilitiesSupported(original, { ...caps, [key]: undefined })).toBe(false);
  const legacyIntent = { ...intent }; delete legacyIntent.nativeSource;
  expect(developmentCapabilitiesSupported({ ...original, intent: legacyIntent }, { ...caps, developmentNativeSourceV1: undefined, nativeUsageTreeV1: undefined })).toBe(true);
});

test('command uses the immutable original intent and revision; signed headers do not redefine its digest', () => {
  const valid = command(), selected = developmentDispatchCommand(original, valid)!;
  expect(selected.developmentUsage).toEqual({ intent, key: registration.key, digestNonce });
  expect(selected.env).toEqual(valid.env);
  expect(developmentDispatchCommand(original, { ...valid, mcp: valid.mcp.map((m) => ({ ...m, headers: { authorization: 'refreshed' } })) })?.developmentUsage).toEqual(selected.developmentUsage);
  const patches = [{ initialPrompt: 'current-prompt' }, { agentId: id(15) }, { cwd: '/other' }, { resumeSessionId: 'current-root' }, { systemPrompt: 'current-system' },
    { permission: 'edit' as const }, { mode: 'oneshot' as const }, { profileRevision: 8 }, { launch: { ...valid.launch, binaryPath: '/other' } }, { mcp: [{ name: 'platform', url: 'http://other.test/', headers: {} }] },
    { beforeStart: { ...valid.beforeStart, profile: id(16) } }, { beforeStart: { ...valid.beforeStart, revision: 8 } }, { processAttemptId: 'new-attempt' }, { businessSecretEnvNames: ['TEMP'] }];
  for (const patch of patches) expect(developmentDispatchCommand(original, { ...valid, ...patch })).toBeUndefined();
  expect(developmentDispatchCommand({ ...original, binding: null }, valid)).toBeUndefined();
  expect(developmentDispatchCommand(original, { ...valid, developmentUsage: { ...selected.developmentUsage!, digestNonce: 'b'.repeat(64) } })).toBeUndefined();
  expect(developmentDispatchCommand({ ...original, digestNonce: 'b'.repeat(64) }, valid)).toBeUndefined();
  expect(developmentDispatchCommand(original, { ...valid, launch: { ...valid.launch, protocol: 'terminal' } })).toBeUndefined();
});
