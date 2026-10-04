import { ExecutionObservationUsageSchema } from '@crewstation/contracts';
import type { NativeUsagePassStep } from './nativeUsagePassTypes';

export interface NativePassSessionRow { id: string; parent_id: string | null }
export interface NativePassQueueRow {
  id: string; parent: string | null; entered: number; parts_done: number;
  part_after: string | null; child_after: string | null;
}
export interface NativePassPartRow {
  id: string; session_id: string; message_id: string; time_created: number; kind: string | null;
  input: unknown; output: unknown; reasoning: unknown; cache_read: unknown; cache_write: unknown;
  provider: unknown; model: unknown;
}
export const nativePassIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

function counter(value: unknown): string | null {
  const candidate = typeof value === 'number'
    ? Number.isSafeInteger(value) && value >= 0 ? String(value) : null : value;
  const parsed = ExecutionObservationUsageSchema.shape.input.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function nativePassMeasurement(
  row: NativePassPartRow, parent: string | null, issues: Set<string>,
): NativeUsagePassStep {
  const output = counter(row.output), reasoning = counter(row.reasoning);
  const usage = {
    input: counter(row.input),
    output: output === null || reasoning === null ? null
      : counter((BigInt(output) + BigInt(reasoning)).toString()),
    cacheRead: counter(row.cache_read), cacheWrite: counter(row.cache_write),
  };
  if (Object.values(usage).some((value) => value === null)) issues.add('native-token-bucket-unknown');
  const model = nativePassIdentifier(row.provider) && row.provider.length <= 200
    && nativePassIdentifier(row.model) && row.model.length <= 300
    ? { provider: row.provider, id: row.model } : null;
  if (model === null) issues.add('native-model-unavailable');
  const occurredAt = Number.isSafeInteger(row.time_created) && row.time_created >= 0
    && row.time_created < 253402300800000 ? row.time_created : null;
  if (occurredAt === null) issues.add('native-time-unavailable');
  return { id: row.session_id, parentSessionId: parent, stepId: row.id, occurredAt, usage, model };
}

// Text/tool bodies stay in the original database. JSON types preserve unknown numeric buckets.
export const nativePassPartFields = `SELECT p.id,p.session_id,p.message_id,p.time_created,
  json_extract(p.data,'$.type') AS kind,
  CASE WHEN json_type(p.data,'$.tokens.input') IN ('integer','real','text') THEN json_extract(p.data,'$.tokens.input') END AS input,
  CASE WHEN json_type(p.data,'$.tokens.output') IN ('integer','real','text') THEN json_extract(p.data,'$.tokens.output') END AS output,
  CASE WHEN json_type(p.data,'$.tokens.reasoning') IN ('integer','real','text') THEN json_extract(p.data,'$.tokens.reasoning') END AS reasoning,
  CASE WHEN json_type(p.data,'$.tokens.cache.read') IN ('integer','real','text') THEN json_extract(p.data,'$.tokens.cache.read') END AS cache_read,
  CASE WHEN json_type(p.data,'$.tokens.cache.write') IN ('integer','real','text') THEN json_extract(p.data,'$.tokens.cache.write') END AS cache_write,
  CASE WHEN json_extract(m.data,'$.role')='assistant' THEN json_extract(m.data,'$.providerID') END AS provider,
  CASE WHEN json_extract(m.data,'$.role')='assistant' THEN json_extract(m.data,'$.modelID') END AS model
  FROM part p LEFT JOIN message m ON m.id=p.message_id AND m.session_id=p.session_id`;
