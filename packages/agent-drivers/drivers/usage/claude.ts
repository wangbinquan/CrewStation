import type { RunnerUsageMeasurement } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { buckets, common, object, readUsage, scope, type UsageContext, type UsageNormalizer, type UsageObject } from './capture';

function validity(raw: UsageObject, usage: RunnerUsageMeasurement['usage']): RunnerUsageMeasurement['validity'] {
  return raw.subtype === 'error_during_execution' && buckets.every((key) => usage[key] === '0') ? 'invalid-final' : 'valid';
}
function modelTotal(raw: UsageObject, context: UsageContext, model: string, value: UsageObject, diagnostics: string[]): RunnerUsageMeasurement {
  const usage = readUsage({ input: value.inputTokens, output: value.outputTokens, cacheRead: value.cacheReadInputTokens, cacheWrite: value.cacheCreationInputTokens }, diagnostics);
  return { ...common(raw, context), recordId: `claude:tree:${jsonHash({ session: context.sessionId, model })}`,
    adapterVersion: 'claude-stream-json/cs@1', actualModel: { provider: null, model, condition: null }, reporting: 'cumulative', inclusion: 'includes-descendants',
    coverage: buckets.every((key) => usage[key] !== null) ? 'complete' : 'partial', validity: validity(raw, usage),
    scope: scope(context, 'tree-total'), coveredThroughTurn: context.turnIndex, usage,
    basis: context.resumeSessionId ? { kind: 'native-session', lineageKey: context.sessionId, baseline: null } : { kind: 'invocation' } };
}
/** Root final evidence only. Per-model totals include native children; final main totals are not a second additive source. */
export const normalizeClaudeUsage: UsageNormalizer = (raw, context, diagnostics) => {
  if (raw.type !== 'result') return [];
  if (raw.parent_tool_use_id != null || raw.isSidechain === true || typeof raw.subagent_type === 'string') { diagnostics.push('unmapped-child-session'); return []; }
  const models = object(raw.modelUsage);
  if (models && Object.keys(models).length) {
    const entries = Object.entries(models);
    if (entries.length > 100 || entries.some(([id, value]) => !id || id.length > 300 || !object(value))) { diagnostics.push('invalid-model-usage'); return []; }
    return entries.map(([model, value]) => modelTotal(raw, context, model, object(value)!, diagnostics));
  }
  const source = object(raw.usage), usage = readUsage({ input: source?.input_tokens, output: source?.output_tokens, cacheRead: source?.cache_read_input_tokens, cacheWrite: source?.cache_creation_input_tokens }, diagnostics);
  return [{ ...common(raw, context), recordId: `claude:main:${jsonHash({ session: context.sessionId, turn: context.turnId })}`,
    adapterVersion: 'claude-stream-json/cs@1', reporting: 'cumulative', inclusion: 'self', scope: scope(context, 'self-total'),
    coveredThroughTurn: context.turnIndex, coverage: buckets.every((key) => usage[key] !== null) ? 'complete' : 'partial',
    validity: validity(raw, usage), usage, basis: { kind: 'invocation' } }];
};
