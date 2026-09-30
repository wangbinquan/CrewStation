// RFC-034 v3: actual source proof and numeric completeness are independent predicates.
import { expect, test } from 'bun:test';
import { DevelopmentUsageRegistrationSchema, type NativeUsageProof, type DevelopmentNativeSource } from '@crewstation/contracts';
import { developmentCaptureSourceId, developmentNativePrefix, developmentNativeState, developmentStreamId, type DevelopmentNativeContext } from './developmentNative';
import { nativeCaptureSummary } from './usageProjection';

const at = '2026-09-30T01:00:00.000Z';
const registration = () => {
  const executionId = Bun.randomUUIDv7();
  return DevelopmentUsageRegistrationSchema.parse({ runtimeTaskId: executionId, key: { executionId, incarnation: crypto.randomUUID(), journalId: crypto.randomUUID(), payloadDigest: 'a'.repeat(64) },
    podUid: 'original-pod', identity: { sourceKind: 'development-agent', projectId: Bun.randomUUIDv7(), taskId: Bun.randomUUIDv7(), agentId: Bun.randomUUIDv7(), executionId, executionGeneration: 1 }, profileId: Bun.randomUUIDv7(), profileRevision: 4 });
};
const context = (): DevelopmentNativeContext => { const r = registration(); return { registration: r, streamSourceId: developmentStreamId(r), selection: { version: 1, expectedNamespace: 'frozen' } }; };
const proof = (state: NativeUsageProof['state'] = 'pending'): NativeUsageProof => ({ contract: 'opencode-child-steps-v1', lineageKey: 'frozen', turn: 'turn', turnIndex: 0,
  observedAt: at, state, root: 'root', baseline: { kind: 'fresh', fingerprint: null }, fingerprint: state === 'pending' ? null : 'final',
  sessions: 1, steps: 1, emitted: 1, baselineSteps: 0, priorRevisionGap: false, issues: [] });
const store = { state: 'observed' as const, sourceEpoch: crypto.randomUUID(), actualPathDigest: 'a'.repeat(64), fileIdentityDigest: 'b'.repeat(64) };
function source(stage: 'begin' | 'finish', patch: Partial<DevelopmentNativeSource> = {}): DevelopmentNativeSource {
  return { version: 1, stage, lineageKey: 'frozen', turn: 'turn', turnIndex: 0, observedAt: at,
    plannedPathDigest: 'c'.repeat(64), scope: stage === 'begin' ? 'unverified' : 'execution-local', beginStore: { state: 'pending' },
    finalStore: stage === 'begin' ? null : store, continuity: stage === 'begin' ? 'unverified' : 'new', issues: [], ...patch };
}
test('partial prior-revision proof qualifies the actual file before numeric repair becomes complete', () => {
  const c = context(), began = developmentNativeState(undefined, c, proof(), source('begin'));
  const partial = { ...proof('partial'), baselineSteps: 1, issues: ['native-prior-revision-gap' as const] };
  const finished = developmentNativeState(began, c, partial, source('finish'));
  expect(finished.sourceVerified).toBe(true);
  const summary = nativeCaptureSummary({ id: 'capture', identity: c.registration.identity, sourceId: 'source', proof: partial,
    began: true, baselineRoot: 'root', historicalRevisionGap: false, development: finished }, { steps: 1, baselines: 1, unresolved: 1, revised: 0 });
  expect(summary.state).toBe('partial'); expect(summary.issues).toContain('native-owner-unresolved');
});
test('finish alone cannot manufacture begin; a late authentic begin can qualify the retained finish', () => {
  const c = context(), finished = developmentNativeState(undefined, c, proof('complete'), source('finish'));
  expect(finished.sourceVerified).toBe(false);
  expect(developmentNativePrefix('one', finished)).toBe('development-pending:one:');
  const verified = developmentNativeState(finished, c, proof(), source('begin'));
  expect(verified.sourceVerified).toBe(true); expect(developmentNativePrefix('one', verified)).toStartWith('development-store:');
  expect(() => developmentNativeState(finished, c, proof(), source('begin', { beginStore: store }))).toThrow();
});
test('namespace, Pod, plan and phase replacements cannot borrow original source proof', () => {
  const c = context(), began = developmentNativeState(undefined, c, proof(), source('begin'));
  for (const other of [ { ...c, selection: { version: 1 as const, expectedNamespace: 'current-hello' } },
    { ...c, registration: { ...c.registration, podUid: 'replacement-pod' } } ])
    expect(() => developmentNativeState(began, other, proof('complete'), source('finish'))).toThrow();
  for (const changed of [source('finish', { plannedPathDigest: 'd'.repeat(64) }), source('finish', { beginStore: store }), source('finish', { lineageKey: 'other' })])
    expect(() => developmentNativeState(began, c, proof('complete'), changed)).toThrow();
  expect(() => developmentNativeState(began, c, proof(), source('begin', { observedAt: '2026-09-30T02:00:00.000Z' }))).toThrow();
});
test('copied files and cross-Pod stores stay in distinct partitions; proof replay has one prefix', () => {
  const c = context(), began = developmentNativeState(undefined, c, proof(), source('begin'));
  const one = developmentNativeState(began, c, proof('complete'), source('finish'));
  const two = developmentNativeState(began, c, proof('complete'), source('finish', { finalStore: { ...store, fileIdentityDigest: 'f'.repeat(64) } }));
  const other = { ...c, registration: { ...c.registration, podUid: 'different-pod' } };
  const three = developmentNativeState(developmentNativeState(undefined, other, proof(), source('begin')), other, proof('complete'), source('finish'));
  expect(new Set([one, two, three].map((s) => developmentNativePrefix('id', s))).size).toBe(3);
  expect(developmentNativePrefix('id', developmentNativeState(one, c, proof('complete'), source('finish')))).toBe(developmentNativePrefix('id', one));
});
test('unavailable, unsupported, changed and unselected sources preserve incomplete quality', () => {
  const c = context(), began = developmentNativeState(undefined, c, proof(), source('begin'));
  for (const finished of [source('finish', { finalStore: { state: 'unavailable' }, continuity: 'unverified', scope: 'unverified' }),
    source('finish', { continuity: 'changed', issues: ['native-source-changed'] }), source('finish', { issues: ['native-source-unsupported'] })])
    expect(developmentNativeState(began, c, proof('partial'), finished).sourceVerified).toBe(false);
  const legacy = { registration: c.registration, streamSourceId: c.streamSourceId };
  const state = developmentNativeState(undefined, legacy, proof('complete'));
  expect(state.sourceVerified).toBe(false); expect(() => developmentNativeState(state, legacy, proof('complete'), source('finish'))).toThrow();
  const summary = nativeCaptureSummary({ id: 'id', identity: c.registration.identity, sourceId: 'source', proof: proof('complete'), began: true,
    baselineRoot: 'root', historicalRevisionGap: false, development: { ...began, overflow: true } }, { steps: 1, baselines: 0, unresolved: 0, revised: 0 });
  expect(summary.state).toBe('partial'); expect(summary.issues).toContain('native-evidence-incomplete');
});
test('one stream holds multiple turn meters while unscoped legacy records retain their stream', () => {
  const c = context();
  expect(developmentCaptureSourceId(c.streamSourceId, null, null)).toBe(c.streamSourceId);
  expect(new Set([['same', 0], ['same', 1], ['other', 0]].map(([turn, index]) => developmentCaptureSourceId(c.streamSourceId, String(turn), Number(index)))).size).toBe(3);
  expect(developmentStreamId({ ...c.registration, profileRevision: 5 })).not.toBe(c.streamSourceId);
});

test('finish-first empty tree cannot borrow a different original begin root; fresh null→root remains valid', () => {
  const c = context(), final = { ...proof('complete'), root: 'B', steps: 0, emitted: 0 };
  const finish = developmentNativeState(undefined, c, final, source('finish'));
  const began = developmentNativeState(finish, c, { ...proof(), root: 'A' }, source('begin'));
  const summary = nativeCaptureSummary({ id: 'id', identity: c.registration.identity, sourceId: 'source', proof: final,
    began: true, baselineRoot: 'B', historicalRevisionGap: false, development: began }, { steps: 0, baselines: 0, unresolved: 0, revised: 0 });
  expect(summary.state).toBe('partial'); expect(summary.issues).toContain('native-root-changed');
  expect(began.sourceVerified).toBe(true); expect(developmentNativePrefix('id', began)).toBe('development-pending:id:');
  const fresh = developmentNativeState(finish, c, { ...proof(), root: null }, source('begin'));
  expect(nativeCaptureSummary({ id: 'id', identity: c.registration.identity, sourceId: 'source', proof: final, began: true,
    baselineRoot: null, historicalRevisionGap: false, development: fresh }, { steps: 0, baselines: 0, unresolved: 0, revised: 0 }).state).toBe('complete');
  expect(() => developmentNativeState(began, c, { ...proof(), root: 'B' }, source('begin'))).toThrow();
});
