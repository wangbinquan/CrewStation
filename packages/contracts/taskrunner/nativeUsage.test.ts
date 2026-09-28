// RFC-034: optional native capture stays compatible with older Runner messages and requires complete proof evidence.
import { expect, test } from 'bun:test';
import { NativeUsageProofSchema, NativeUsageBaselineSchema } from './nativeUsage';
import { RunnerHelloSchema, RunnerCommandSchema, TASKRUNNER_PROTOCOL_VERSION } from './protocol';
import { RunnerUsageCaptureSchema } from './usageObservation';
const at = '2026-09-28T00:00:00.000Z';
const complete = { contract: 'opencode-child-steps-v1', lineageKey: 'session', turn: 'turn', turnIndex: 0, state: 'complete', root: 'root', observedAt: at,
  baseline: { kind: 'fresh', fingerprint: null }, fingerprint: 'final', sessions: 1, steps: 0, emitted: 0, baselineSteps: 0, priorRevisionGap: false, issues: [] };
test('complete native proof requires real root, traversal, consistent counts and a known resume baseline', () => {
  expect(NativeUsageProofSchema.safeParse(complete).success).toBe(true);
  for (const patch of [{ root: null }, { fingerprint: null }, { sessions: 0 }, { steps: 1 }, { baseline: { kind: 'resume', fingerprint: null } }, { priorRevisionGap: true }, { issues: ['native-read-failed'] }])
    expect(NativeUsageProofSchema.safeParse({ ...complete, ...patch }).success).toBe(false);
  expect(NativeUsageProofSchema.safeParse({ ...complete, state: 'partial', root: null, fingerprint: null, issues: ['native-store-unavailable'] }).success).toBe(true);
});
test('proof frames coexist with legacy numeric frames and bound baseline pages', () => {
  const old = { version: 1 as const, measurements: [], diagnostics: [] };
  expect(RunnerUsageCaptureSchema.parse(old)).toEqual(old);
  expect(RunnerUsageCaptureSchema.parse({ ...old, nativeProof: complete }).nativeProof?.state).toBe('complete');
  expect(NativeUsageBaselineSchema.safeParse({ lineageKey: 'session', turn: 'turn', root: 'root', offset: 0, steps: [] }).success).toBe(true);
  expect(NativeUsageBaselineSchema.safeParse({ lineageKey: 'session', turn: 'turn', root: 'root', offset: 10001, steps: [] }).success).toBe(false);
});
test('native-tree capability is opt-in and depends on usage observations without a Runner protocol bump', () => {
  const hello = { type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId: Bun.randomUUIDv7(), runnerToken: 'fixture', workdir: '/work', capabilities: { protocols: ['opencode'], pty: false, preview: false } };
  expect(RunnerHelloSchema.safeParse(hello).success).toBe(true);
  expect(RunnerHelloSchema.safeParse({ ...hello, capabilities: { ...hello.capabilities, nativeUsageTreeV1: 1 } }).success).toBe(false);
  expect(RunnerHelloSchema.safeParse({ ...hello, capabilities: { ...hello.capabilities, usageObservationsV1: 1, nativeUsageTreeV1: 1 } }).success).toBe(true);
  expect(RunnerCommandSchema.safeParse({ id: 'query', type: 'businessExecutionInfo', nativeUsageTreeV1: 1 }).success).toBe(false);
  expect(RunnerCommandSchema.safeParse({ id: 'query', type: 'businessExecutionInfo', usageObservationsV1: 1, nativeUsageTreeV1: 1 }).success).toBe(true);
});
