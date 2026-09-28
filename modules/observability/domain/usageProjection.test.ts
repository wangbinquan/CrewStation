import { expect, test } from 'bun:test';
import { ExecutionObservationIdentitySchema, ExecutionUsageObservationSchema } from '@crewstation/contracts';
import { rebuildUsageProjection, type UsageEvidence } from './usageProjection';

const identity = ExecutionObservationIdentitySchema.parse({
  projectId: '01a0bf5d-8f4b-7793-867c-efd7527b3861', taskId: '01a0bf5d-8f4b-7793-867c-efd7527b3862',
  subtaskId: '01a0bf5d-8f4b-7793-867c-efd7527b3863', executionId: '01a0bf5d-8f4b-7793-867c-efd7527b3864', executionGeneration: 1,
});
const sample = (revision: number, input: string | null, patch: Partial<UsageEvidence> = {}): UsageEvidence => ({
  kind: 'usage', identity, sourceId: 'runner', recordId: 'meter', revision,
  occurredAt: null, observedAt: '2026-09-28T00:00:00.000Z', adapterVersion: 'fixture-v1',
  modelRef: 'provider/model', reporting: 'cumulative', inclusion: 'self', coverage: 'complete', validity: 'valid',
  scope: { root: 'session', session: 'session', parentSession: null, ancestors: [], turn: 'turn', turnIndex: 0, level: 'self-total' },
  coveredThroughTurn: revision, usage: { input, output: '0', cacheRead: '0', cacheWrite: '0' }, basis: { kind: 'invocation' }, ...patch,
});

test('late older evidence creates a new projection without advancing the native maximum', () => {
  const valid = sample(1, '120'), final = sample(2, '0', { validity: 'invalid-final' });
  const first = rebuildUsageProjection([final]);
  expect(first.projection).toMatchObject({ projectionRevision: 1, observedRevision: 2, contribution: { input: null }, complete: false });
  const recovered = rebuildUsageProjection([final, valid], first);
  expect(recovered.projection).toMatchObject({ projectionRevision: 2, observedRevision: 2, contribution: { input: '120' }, complete: false, issues: ['invalid-final'] });
  expect(ExecutionUsageObservationSchema.safeParse(recovered).success).toBe(true);
  expect(rebuildUsageProjection([valid, final, valid], recovered)).toBe(recovered);
});
test('unknown buckets retain known contribution and their own coverage watermark', () => {
  const prior = sample(1, '100'), next = sample(2, null, { coverage: 'partial', usage: { input: null, output: '8', cacheRead: '0', cacheWrite: '0' } });
  const result = rebuildUsageProjection([next, prior]);
  expect(result.usage.input).toBeNull();
  expect(result.projection).toMatchObject({ contribution: { input: '100', output: '8' }, coveredThrough: { input: 1, output: 2 }, complete: false });
  expect(ExecutionUsageObservationSchema.safeParse(result).success).toBe(true);
});
for (const rejected of [
  sample(1, '0', { validity: 'invalid-final' }),
  sample(1, '120', { validity: 'invalid-final' }),
  sample(1, '90', { basis: { kind: 'native-session', lineageKey: 'lineage', baseline: { input: '100', output: '0', cacheRead: '0', cacheWrite: '0' } } }),
]) {
  test('rejected first evidence never supplies reusable counters: ' + rejected.validity + '/' + rejected.usage.input, () => {
    const partial = sample(2, null, { basis: rejected.basis, coverage: 'partial', usage: { input: null, output: '8', cacheRead: '0', cacheWrite: '0' } });
    const first = rebuildUsageProjection([rejected]);
    const result = rebuildUsageProjection([rejected, partial], first);
    expect(result.projection).toMatchObject({ contribution: { input: null, output: '8' }, coveredThrough: { input: null, output: 2 }, complete: false, issues: [] });
    expect(result.usage.input).toBeNull();
    expect(rebuildUsageProjection([partial, rejected])).toMatchObject({ projection: { contribution: result.projection.contribution } });
    expect(ExecutionUsageObservationSchema.safeParse(result).success).toBe(true);
  });
}
test('decreases need explicit correction and conflicting native duplicates fail', () => {
  const first = sample(1, '100'), decrease = sample(2, '40');
  expect(rebuildUsageProjection([first, decrease]).projection).toMatchObject({ contribution: { input: '100' }, issues: ['unexplained-decrease'] });
  expect(rebuildUsageProjection([first, { ...decrease, validity: 'correction' }]).projection).toMatchObject({ contribution: { input: '40' }, complete: true });
  expect(() => rebuildUsageProjection([first, { ...first, observedAt: '2026-09-28T00:00:01.000Z' }])).toThrow('Conflicting native usage revision');
});
test('resumed counters subtract only known same-lineage baselines and preserve unknowns', () => {
  const base = { input: '100', output: '0', cacheRead: '0', cacheWrite: '0' };
  const raw = sample(1, '130', { basis: { kind: 'native-session', lineageKey: 'lineage', baseline: base } });
  expect(rebuildUsageProjection([raw]).projection).toMatchObject({ contribution: { input: '30' }, complete: true });
  expect(rebuildUsageProjection([{ ...raw, basis: { kind: 'native-session', lineageKey: 'lineage', baseline: null } }]).projection).toMatchObject({ contribution: { input: null }, complete: false, issues: ['baseline-unknown'] });
  expect(rebuildUsageProjection([{ ...raw, usage: { ...raw.usage, input: '90' } }]).projection.issues).toEqual(['baseline-exceeds-observation']);
});
test('unknown inclusion and identity changes stay partial; no scope keeps null watermarks', () => {
  const first = sample(1, '10', { scope: null, coveredThroughTurn: null, inclusion: 'unknown' });
  expect(rebuildUsageProjection([first]).projection).toMatchObject({ complete: false, issues: ['unknown-inclusion'], coveredThrough: null });
  expect(rebuildUsageProjection([sample(1, '10'), sample(2, '20', { modelRef: 'other' })]).projection).toMatchObject({ contribution: { input: '10' }, complete: false, issues: ['identity-conflict'] });
  expect(() => rebuildUsageProjection([])).toThrow('Cannot rebuild usage without retained evidence');
  const max = rebuildUsageProjection([sample(1, '10')]);
  max.projection.projectionRevision = Number.MAX_SAFE_INTEGER;
  expect(() => rebuildUsageProjection([sample(2, '20')], max)).toThrow('Usage projection revision exhausted');
});


test('late actual-model attribution refines one record without adding Tokens or allowing replacement', () => {
  const unknown = sample(1, '100', { modelRef: null }), known = sample(2, '100', { modelRef: 'actual-route' });
  const initial = rebuildUsageProjection([unknown]);
  const recovered = rebuildUsageProjection([known, unknown], initial);
  expect(recovered.modelRef).toBe('actual-route');
  expect(recovered.projection).toMatchObject({ contribution: { input: '100' }, projectionRevision: 2, observedRevision: 2, issues: [] });
  expect(rebuildUsageProjection([unknown, known], recovered)).toBe(recovered);
  for (const modelRef of ['different-route', null]) {
    const conflicting = rebuildUsageProjection([unknown, known, sample(3, '120', { modelRef })]);
    expect(conflicting).toMatchObject({ modelRef: 'actual-route', projection: { contribution: { input: '100' }, issues: ['identity-conflict'] } });
  }
});


test('late actual model on a rejected decrease preserves numeric revision and partial coverage', () => {
  const unknown = sample(1, '100', { modelRef: null }), lower = sample(2, '90', { modelRef: 'actual-route' });
  const before = rebuildUsageProjection([unknown]);
  const refined = rebuildUsageProjection([lower, unknown], before);
  expect(refined).toMatchObject({ revision: 1, usage: before.usage, modelRef: 'actual-route', projection: {
    observedRevision: 2, modelRevision: 2, contribution: before.projection.contribution,
    coveredThrough: before.projection.coveredThrough, complete: false, issues: ['unexplained-decrease'],
  } });
  expect(ExecutionUsageObservationSchema.safeParse(refined).success).toBe(true);
  const updated = rebuildUsageProjection([unknown, lower, sample(3, '120', { modelRef: 'actual-route' })], refined);
  expect(updated.projection.modelRevision).toBe(2); expect(updated.projection.contribution.input).toBe('120');
  const invalid = rebuildUsageProjection([unknown, { ...lower, validity: 'invalid-final' }]);
  expect(invalid.modelRef).toBeNull(); expect(invalid.projection.modelRevision).toBeUndefined();
});
