import { z } from 'zod';

const attribute = z.object({ key: z.string(), value: z.object({ stringValue: z.string().optional(), intValue: z.union([z.string(), z.number()]).optional() }) });
const attributes = z.array(attribute).max(256);
const record = z.object({ traceId: z.string().optional(), spanId: z.string().optional(), attributes: attributes.optional() });
const span = record.extend({ name: z.string(), endTimeUnixNano: z.string().optional() });
const logs = z.object({ resourceLogs: z.array(z.object({ resource: z.object({ attributes }), scopeLogs: z.array(z.object({ logRecords: z.array(record).max(8192) })) })).max(16) });
const traces = z.object({ resourceSpans: z.array(z.object({ resource: z.object({ attributes }), scopeSpans: z.array(z.object({ spans: z.array(span).max(8192) })) })).max(16) });
const metrics = z.object({ resourceMetrics: z.array(z.object({ resource: z.object({ attributes }), scopeMetrics: z.array(z.unknown()).max(16) })).min(1).max(16) });

export type ClaudeNativeTelemetry =
  | { type: 'prompt-trace'; sessionId: string; promptId: string; traceId: string; spanId: string }
  | { type: 'interaction-ended'; sessionId: string; traceId: string; spanId: string }
  | { type: 'heartbeat' };

function values(items: z.infer<typeof attributes> = []): Record<string, string | number> {
  return Object.fromEntries(items.flatMap(({ key, value }) => value.stringValue !== undefined ? [[key, value.stringValue]] : value.intValue !== undefined ? [[key, value.intValue]] : []));
}
function version(items: z.infer<typeof attributes>): void {
  const attrs = values(items);
  if (attrs['service.name'] !== 'claude-code' || attrs['service.version'] !== '2.1.268') throw new Error('Unsupported native telemetry source');
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 96) throw new Error('Missing native telemetry identity');
  return value;
}

/** 不使用 status=UNSET 判成功，也不采集 prompt、响应正文、工具详情或用户身份。 */
export function parseClaudeNativeTelemetry(kind: 'logs' | 'traces' | 'metrics', body: unknown): ClaudeNativeTelemetry[] {
  if (kind === 'metrics') {
    for (const item of metrics.parse(body).resourceMetrics) version(item.resource.attributes);
    return [{ type: 'heartbeat' }];
  }
  const result: ClaudeNativeTelemetry[] = [];
  if (kind === 'logs') {
    for (const resource of logs.parse(body).resourceLogs) {
      version(resource.resource.attributes);
      for (const scope of resource.scopeLogs) for (const item of scope.logRecords) {
        const attrs = values(item.attributes);
        if (attrs['event.name'] !== 'user_prompt') continue;
        result.push({ type: 'prompt-trace', sessionId: identifier(attrs['session.id']), promptId: identifier(attrs['prompt.id']), traceId: identifier(item.traceId), spanId: identifier(item.spanId) });
      }
    }
  } else {
    for (const resource of traces.parse(body).resourceSpans) {
      version(resource.resource.attributes);
      for (const scope of resource.scopeSpans) for (const item of scope.spans) {
        if (item.name !== 'claude_code.interaction' || !item.endTimeUnixNano || item.endTimeUnixNano === '0') continue;
        const attrs = values(item.attributes);
        if (attrs['parent.source'] !== 'none') continue;
        result.push({ type: 'interaction-ended', sessionId: identifier(attrs['session.id']), traceId: identifier(item.traceId), spanId: identifier(item.spanId) });
      }
    }
  }
  return result;
}
