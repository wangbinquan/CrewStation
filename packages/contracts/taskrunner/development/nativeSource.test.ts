// RFC-034: isolate optional development source metadata from business v1 and ordinary events.
import { expect, test } from 'bun:test';
import { AgentEventSchema } from '../agentEvents';
import { RunnerUsageCaptureSchema } from '../usageObservation';
import { DevelopmentUsageEventSchema, DevelopmentStartIntentSchema } from '../developmentUsage';
import { RunnerHelloSchema, TASKRUNNER_PROTOCOL_VERSION } from '../protocol';

const at = '2026-09-30T00:00:00.000Z';
const store = { state: 'observed', sourceEpoch: '019f0000-0000-7000-8000-000000000001', actualPathDigest: 'a'.repeat(64), fileIdentityDigest: 'b'.repeat(64) };
function capture(stage = 'finish', kind = 'fresh') {
  return { version: 1, measurements: [], diagnostics: [], nativeProof: { contract: 'opencode-child-steps-v1', lineageKey: 'namespace', turn: 'turn', turnIndex: 0,
    state: stage === 'begin' ? 'pending' : 'complete', root: 'root', observedAt: at, baseline: { kind, fingerprint: kind === 'resume' ? 'baseline' : null },
    fingerprint: stage === 'begin' ? null : 'final', sessions: stage === 'begin' ? 0 : 1, steps: 0, emitted: 0, baselineSteps: 0, priorRevisionGap: false, issues: [] },
    nativeSource: { version: 1, stage, lineageKey: 'namespace', turn: 'turn', turnIndex: 0, observedAt: at, plannedPathDigest: 'c'.repeat(64), scope: 'execution-local', beginStore: store, finalStore: stage === 'begin' ? null : store, continuity: stage === 'begin' ? 'unverified' : 'same', issues: [] } };
}
const parse = (value: unknown) => DevelopmentUsageEventSchema.safeParse({ sequence: 1, occurredAt: at, capture: value });
test('development accepts matching begin/final source frames while shared captures and ordinary events reject the field', () => {
  for (const frame of [capture('begin'), capture(), capture('finish', 'resume')]) {
    expect(parse(frame).success).toBe(true);
    expect(RunnerUsageCaptureSchema.safeParse(frame).success).toBe(false);
    expect(AgentEventSchema.safeParse({ agentId: 'agent', seq: 1, at, type: 'usage', usageCapture: frame }).success).toBe(false);
    const { nativeSource: _source, ...legacy } = frame;
    expect(RunnerUsageCaptureSchema.parse(legacy) as unknown).toEqual(legacy); expect(parse(legacy).success).toBe(true);
  }
});
test('strict source records reject identities on unknown stores, unknown fields, workspace guesses and malformed digests', () => {
  const value = capture();
  const changes = [{ unexpected: true }, { scope: 'workspace' }, { plannedPathDigest: 'short' }, { beginStore: { state: 'pending', sourceEpoch: store.sourceEpoch } }, { finalStore: { ...store, sourceEpoch: 'not-a-uuid' } }, { issues: ['native-source-changed', 'native-source-changed'] }, { issues: ['arbitrary-path-or-secret'] }];
  for (const change of changes) expect(parse({ ...value, nativeSource: { ...value.nativeSource, ...change } }).success).toBe(false);
});
test('source proof must bind the same turn, time and namespace and cannot be combined with native history', () => {
  const value = capture();
  for (const change of [{ turn: 'other' }, { lineageKey: 'other' }, { turnIndex: 1 }, { observedAt: '2026-09-30T00:00:01.000Z' }, { stage: 'begin', finalStore: null, continuity: 'unverified' }]) expect(parse({ ...value, nativeSource: { ...value.nativeSource, ...change } }).success).toBe(false);
  expect(parse({ ...value, nativeBaseline: { lineageKey: 'namespace', turn: 'turn', root: 'root', offset: 0, steps: [] } }).success).toBe(false);
});
test('fresh pending to observed may be new, but resume gaps and changed stores cannot claim complete', () => {
  const value = capture(), next = { ...value.nativeSource, beginStore: { state: 'pending' }, continuity: 'new' };
  expect(parse({ ...value, nativeSource: next }).success).toBe(true);
  expect(parse({ ...capture('finish', 'resume'), nativeSource: next }).success).toBe(false);
  for (const change of [{ finalStore: { ...store, fileIdentityDigest: 'd'.repeat(64) } }, { finalStore: { state: 'unavailable' }, continuity: 'unverified', scope: 'unverified' }, { continuity: 'changed' }, { issues: ['native-source-read-failed'] }]) expect(parse({ ...value, nativeSource: { ...value.nativeSource, ...change } }).success).toBe(false);
  expect(parse({ ...value, nativeProof: { ...value.nativeProof, state: 'partial' }, nativeSource: { ...value.nativeSource, continuity: 'changed' } }).success).toBe(true);
});
test('source capability requires development numeric capability and omission preserves legacy hello JSON', () => {
  const hello = { type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId: store.sourceEpoch, runnerToken: 'token', workdir: '/work', capabilities: { protocols: ['opencode'], pty: false, preview: false } };
  expect(RunnerHelloSchema.parse(hello) as unknown).toEqual(hello);
  expect(RunnerHelloSchema.safeParse({ ...hello, capabilities: { ...hello.capabilities, developmentNativeSourceV1: 1 } }).success).toBe(false);
  const selected = { ...hello, capabilities: { ...hello.capabilities, developmentNativeSourceV1: 1, developmentUsageV1: 1, usageObservationsV1: 1 } };
  expect(RunnerHelloSchema.parse(selected) as unknown).toEqual(selected);
});
test('source selection is an optional strict immutable intent field, never a default from current hello', () => {
  const option = DevelopmentStartIntentSchema.shape.nativeSource;
  expect(option.parse(undefined)).toBeUndefined(); expect(option.parse({ version: 1 })).toEqual({ version: 1 });
  for (const value of [{}, { version: 2 }, { version: 1, path: '/private' }]) expect(option.safeParse(value).success).toBe(false);
});
