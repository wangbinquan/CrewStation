import type { BusinessUsage } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { opencodeOutputNumber } from './usage/opencodeOutput';

const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Missing counters remain unknown. Claude final totals and OpenCode step totals use separate cumulative scopes. */
export function businessUsage(protocol: 'claude-code' | 'opencode', source: Record<string, unknown>): BusinessUsage | undefined {
  if (source['parent_tool_use_id'] != null || source['isSidechain'] === true) return undefined;
  const part = object(source['part']);
  if (protocol === 'claude-code' && source['type'] !== 'result') return undefined;
  if (protocol === 'opencode' && source['type'] !== 'step_finish') return undefined;
  const usage = protocol === 'claude-code' ? object(source['usage']) : object(source['tokens']) ?? object(part?.['tokens']) ?? object(source['usage']);
  const cache = object(usage?.['cache']);
  const counters = {
    inputTokens: count(usage?.['input_tokens'] ?? usage?.['input'] ?? usage?.['prompt_tokens']),
    outputTokens: protocol === 'opencode' && usage?.['output'] !== undefined ? opencodeOutputNumber(usage) : count(usage?.['output_tokens'] ?? usage?.['output'] ?? usage?.['completion_tokens']),
    cacheReadTokens: count(usage?.['cache_read_input_tokens'] ?? usage?.['cache_read'] ?? usage?.['cacheRead'] ?? cache?.['read']),
    cacheWriteTokens: count(usage?.['cache_creation_input_tokens'] ?? usage?.['cache_creation'] ?? usage?.['cacheCreation'] ?? cache?.['write']),
  };
  const native = source['uuid'] ?? source['id'] ?? part?.['id'];
  const identity = typeof native === 'string' && native.length ? jsonHash(native) : jsonHash(source);
  return { measurementId: `${protocol}:${identity}:${jsonHash(counters)}`, scope: `${protocol}:${identity}`, mode: 'cumulative', ...counters,
    complete: typeof native === 'string' && Object.values(counters).every((value) => value !== null) };
}
