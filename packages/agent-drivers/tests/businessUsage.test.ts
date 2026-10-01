import { expect, test } from 'bun:test';
import { parseEvent as claude } from '../drivers/claudeCode/events';
import { parseEvent as opencode } from '../drivers/opencode/events';

test('Claude exposes final cumulative usage with stable measurement identity and nullable unknown fields', () => {
  const source = { type: 'result', uuid: 'turn-1', session_id: 'session', usage: { input_tokens: 10, output_tokens: 0 } };
  const usage = claude(JSON.stringify(source))!.businessUsage!;
  expect(usage).toMatchObject({ mode: 'cumulative', inputTokens: 10, outputTokens: 0, cacheReadTokens: null, cacheWriteTokens: null, complete: false });
  expect(claude(JSON.stringify(source))!.businessUsage).toEqual(usage);
  const complete = claude(JSON.stringify({ ...source, usage: { ...source.usage, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } }))!.businessUsage!;
  expect(complete.scope).toBe(usage.scope); expect(complete.measurementId).not.toBe(usage.measurementId); expect(complete.complete).toBe(true);
  expect(claude(JSON.stringify({ ...source, type: 'assistant' }))!.businessUsage).toBeUndefined();
  expect(claude(JSON.stringify({ ...source, parent_tool_use_id: 'child' }))!.businessUsage).toBeUndefined();
});

test('OpenCode step scopes avoid double-counting updates and never invent zero usage when counters are absent', () => {
  const source = { type: 'step_finish', sessionID: 'session', part: { id: 'step-1', tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 1, write: 2 } } } };
  const usage = opencode(JSON.stringify(source))!.businessUsage!;
  expect(usage).toMatchObject({ mode: 'cumulative', inputTokens: 10, outputTokens: 5, cacheReadTokens: 1, cacheWriteTokens: 2, complete: true });
  const updated = opencode(JSON.stringify({ ...source, part: { ...source.part, tokens: { input: 12 } } }))!.businessUsage!;
  expect(updated.scope).toBe(usage.scope); expect(updated.measurementId).not.toBe(usage.measurementId);
  const missing = opencode(JSON.stringify({ type: 'step_finish', part: { id: 'step-2' } }))!.businessUsage!;
  expect(missing).toMatchObject({ inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, complete: false });
  expect(missing.scope).not.toBe(usage.scope);
  const invalid = opencode(JSON.stringify({ type: 'step_finish', tokens: { input: -1, output: '7', cache_read: 1.5 } }))!.businessUsage!;
  expect(invalid).toMatchObject({ inputTokens: null, outputTokens: null, cacheReadTokens: null, complete: false });
});

// RFC-034: the business wire and numeric observation stream must agree on reasoning.
test('native output adds reasoning once while generic completion totals and Claude stay unchanged', () => {
  const native = (output: unknown, reasoning: unknown) => opencode(JSON.stringify({ type: 'step_finish', part: { id: 'one', tokens: { input: 10, output, reasoning, cache: { read: 0, write: 0 } } } }))!.businessUsage!;
  const first = native(53, 1), corrected = native(53, 7);
  expect(first.outputTokens).toBe(54); expect(corrected.outputTokens).toBe(60);
  expect(corrected.scope).toBe(first.scope); expect(corrected.measurementId).not.toBe(first.measurementId);
  expect(native('53', '1').outputTokens).toBe(54);
  for (const value of [undefined, null, -1, 1.5, 'bad', '9007199254740993']) expect(native(53, value).outputTokens).toBeNull();
  expect(opencode(JSON.stringify({ type: 'step_finish', part: { id: 'generic', tokens: { output_tokens: 54, reasoning: 1 } } }))!.businessUsage!.outputTokens).toBe(54);
  expect(claude(JSON.stringify({ type: 'result', uuid: 'claude', usage: { output_tokens: 54, reasoning: 1 } }))!.businessUsage!.outputTokens).toBe(54);
});
