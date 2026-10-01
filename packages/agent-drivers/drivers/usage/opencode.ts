import { buckets, common, identifier, object, readUsage, scope, type UsageNormalizer } from './capture';
import { jsonHash } from '@crewstation/kernel';
import { opencodeOutput } from './opencodeOutput';

/** Pinned native step-finish fields; stdout has no reliable actual provider/model. */
export const normalizeOpencodeUsage: UsageNormalizer = (raw, context, diagnostics) => {
  if (raw.type !== 'step_finish') return [];
  const part = object(raw.part), id = identifier(part?.id), tokens = object(part?.tokens), cache = object(tokens?.cache);
  if (!id) { diagnostics.push('missing-step-identity'); return []; }
  if (part?.sessionID !== undefined && part.sessionID !== context.sessionId) { diagnostics.push('step-session-mismatch'); return []; }
  const usage = readUsage({ input: tokens?.input, output: opencodeOutput(tokens, diagnostics), cacheRead: cache?.read, cacheWrite: cache?.write }, diagnostics);
  return [{ ...common(raw, context), recordId: `opencode:step:${jsonHash({ session: context.sessionId, id })}`,
    adapterVersion: 'opencode-step-finish/1.15.5-1.18.31/cs@2', reporting: 'delta', inclusion: 'self', scope: scope(context, 'request'),
    coverage: buckets.every((key) => usage[key] !== null) ? 'complete' : 'partial', validity: 'valid', usage, basis: { kind: 'invocation' } }];
};
