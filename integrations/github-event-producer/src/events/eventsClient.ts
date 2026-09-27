import { PRODUCE_PATH } from '../platform/environment';
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export interface ProducedEvent { eventType: string; dedupKey: string; occurredAt: string; traceId?: string | null; payload: unknown }
export class ProduceFailed extends Error {
  constructor(readonly reason: string, readonly retryable: boolean, readonly status?: number) { super(reason); this.name = 'ProduceFailed'; }
}
export async function produceEvent(event: ProducedEvent, options: { baseUrl: string; fetch?: FetchLike; timeoutMs?: number }) {
  const signal = AbortSignal.timeout(options.timeoutMs ?? 8000);
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${options.baseUrl}${PRODUCE_PATH}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(event.traceId ? { 'x-cs-trace-id': event.traceId } : {}) },
      body: JSON.stringify({ ...event, traceId: event.traceId ?? undefined }), signal,
    });
  } catch {
    throw new ProduceFailed(signal.aborted ? 'cs-events timed out' : 'cs-events connection failed', true);
  }
  if (!response.ok) throw new ProduceFailed(`cs-events rejected: HTTP ${response.status}`, response.status >= 500, response.status);
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.eventId !== 'string' || !body.eventId || typeof body.deduplicated !== 'boolean'
    || typeof body.deliveries !== 'number' || !Number.isSafeInteger(body.deliveries) || body.deliveries < 0) {
    throw new ProduceFailed('Invalid cs-events receipt', true, response.status);
  }
  return { eventId: body.eventId, deduplicated: body.deduplicated, deliveries: body.deliveries };
}
