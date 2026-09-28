import { expect, test } from 'bun:test';
import { RunnerUsageCaptureSchema } from '@crewstation/contracts';
import { parseEvent as claude } from '../claudeCode/events';
import { parseEvent as opencode } from '../opencode/events';
import { createUsageObserver, type UsageNormalizer } from './capture';
import { normalizeClaudeUsage } from './claude';
import { normalizeOpencodeUsage } from './opencode';

const at = Date.parse('2026-09-28T12:00:00Z');
const step = (tokens: unknown = { input: 10, output: 3, cache: { read: 2, write: 0 } }) => ({ type: 'step_finish', sessionID: 'native', part: { id: 'part-one', sessionID: 'native', tokens } });
const final = (input = 10, id = 'result-one') => ({ type: 'result', uuid: id, session_id: 'native', usage: { input_tokens: input }, modelUsage: { actual: { inputTokens: input, outputTokens: 3, cacheReadInputTokens: 2, cacheCreationInputTokens: 0 } } });

test('OpenCode records exact disjoint counters and actual-model absence without configured defaults', () => {
  const capture = createUsageObserver(normalizeOpencodeUsage, 'agent', 'native').beginTurn();
  const first = capture(opencode(JSON.stringify(step()))!, at)!;
  expect(RunnerUsageCaptureSchema.safeParse(first).success).toBe(true);
  expect(first.measurements[0]).toMatchObject({ reporting: 'delta', inclusion: 'self', actualModel: null, basis: { kind: 'invocation' },
    usage: { input: '10', output: '3', cacheRead: '2', cacheWrite: '0' }, coverage: 'complete', scope: { root: 'native', session: 'native', level: 'request', turnIndex: 0 } });
  expect(capture(opencode(JSON.stringify(step()))!, at + 1)).toBeUndefined();
  const revised = capture(opencode(JSON.stringify(step({ input: '9007199254740993', output: -1, cache: { read: 1.5 } })))!, at + 2)!;
  expect(revised.measurements[0]?.recordId).toBe(first.measurements[0]?.recordId);
  expect(revised.measurements[0]?.revision).toBeGreaterThan(first.measurements[0]!.revision);
  expect(revised.measurements[0]?.usage).toEqual({ input: '9007199254740993', output: null, cacheRead: null, cacheWrite: null });
  expect(revised.diagnostics).toEqual(['invalid-counter']);
});

test('Claude model totals keep their cumulative scope across turns and resume baseline stays unknown', () => {
  const observer = createUsageObserver(normalizeClaudeUsage, 'agent', 'native');
  const first = observer.beginTurn()(claude(JSON.stringify(final()))!, at)!.measurements[0]!;
  const second = observer.beginTurn()(claude(JSON.stringify(final(15, 'result-two')))!, at + 1)!.measurements[0]!;
  expect(first).toMatchObject({ actualModel: { model: 'actual', provider: null }, inclusion: 'includes-descendants',
    scope: { level: 'tree-total', turnIndex: 0 }, basis: { kind: 'native-session', lineageKey: 'native', baseline: null }, coveredThroughTurn: 0 });
  expect(second.recordId).toBe(first.recordId); expect(second.scope).toEqual(first.scope);
  expect(second.coveredThroughTurn).toBe(1); expect(second.usage.input).toBe('15');
  const fresh = createUsageObserver(normalizeClaudeUsage, 'fresh', '').beginTurn()(claude(JSON.stringify(final()))!, at)!;
  expect(fresh.measurements[0]?.basis).toEqual({ kind: 'invocation' });
  expect(fresh.measurements).toHaveLength(1); // No second main-total measurement added to the tree total.
});

test('late duplicate native results retain their original turn and invalid final zeros are explicit', () => {
  const observer = createUsageObserver(normalizeClaudeUsage, 'agent'), firstTurn = observer.beginTurn();
  const first = firstTurn(claude(JSON.stringify(final()))!, at)!;
  const laterTurn = observer.beginTurn();
  expect(laterTurn(claude(JSON.stringify(final()))!, at + 1)).toBeUndefined();
  const corrected = laterTurn(claude(JSON.stringify(final(11)))!, at + 2)!;
  expect(corrected.measurements[0]?.coveredThroughTurn).toBe(first.measurements[0]?.coveredThroughTurn);
  const zero = { ...final(), subtype: 'error_during_execution', modelUsage: { actual: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
  expect(laterTurn(claude(JSON.stringify(zero))!, at + 3)?.measurements[0]?.validity).toBe('invalid-final');
});

test('main-only results have separate turn scopes, nullable buckets and no guessed model or currency', () => {
  const observer = createUsageObserver(normalizeClaudeUsage, 'agent');
  const main = (id: string) => claude(JSON.stringify({ type: 'result', session_id: 'native', uuid: id, usage: { output_tokens: 0 }, cost_usd: 99, model: 'configured-looking' }))!;
  const first = observer.beginTurn()(main('one'), at)!.measurements[0]!;
  const second = observer.beginTurn()(main('two'), at)!.measurements[0]!;
  expect(first).toMatchObject({ actualModel: null, coverage: 'partial', usage: { input: null, cacheRead: null, cacheWrite: null, output: '0' }, scope: { level: 'self-total', turnIndex: 0 } });
  expect(second.recordId).not.toBe(first.recordId); expect(second.scope?.turnIndex).toBe(1);
  expect(JSON.stringify(first)).not.toContain('usd');
});

test('missing native identity, malformed evidence and unexpected normalizer errors remain visible gaps', () => {
  const capture = createUsageObserver(normalizeOpencodeUsage, 'agent').beginTurn();
  expect(capture(opencode(JSON.stringify({ ...step(), sessionID: undefined }))!, at)?.diagnostics).toEqual(['missing-native-session']);
  expect(capture(opencode(JSON.stringify({ type: 'step_finish', sessionID: 'native' }))!, at)?.diagnostics).toEqual(['missing-measurement-identity']);
  expect(capture(opencode(JSON.stringify({ ...step(), part: { ...step().part, sessionID: 'child' } }))!, at)?.diagnostics).toEqual(['step-session-mismatch']);
  const broken: UsageNormalizer = () => { throw new Error('parser unavailable'); };
  expect(createUsageObserver(broken, 'agent').beginTurn()(opencode(JSON.stringify(step()))!, at)).toEqual({ version: 1, measurements: [], diagnostics: ['usage-normalization-failed'] });
  expect(capture(opencode(JSON.stringify({ type: 'text', text: 'hello' }))!, at)).toBeUndefined();
  const bad = { ...final(), modelUsage: { invalid: 'not a model total' } };
  expect(createUsageObserver(normalizeClaudeUsage, 'agent').beginTurn()(claude(JSON.stringify(bad))!, at)?.diagnostics).toEqual(['invalid-model-usage']);
});

test('source schema rejects noncanonical buckets, amounts, and inconsistent native coverage', () => {
  const value = createUsageObserver(normalizeClaudeUsage, 'agent').beginTurn()(claude(JSON.stringify(final()))!, at)!;
  const item = value.measurements[0]!;
  for (const candidate of [{ ...item, usage: { ...item.usage, input: '-1' } }, { ...item, amount: '1.00' },
    { ...item, scope: null }, { ...item, coveredThroughTurn: null },
    { ...item, scope: { ...item.scope, ancestors: ['wrong'] } }]) {
    expect(RunnerUsageCaptureSchema.safeParse({ ...value, measurements: [candidate] }).success).toBe(false);
  }
});
