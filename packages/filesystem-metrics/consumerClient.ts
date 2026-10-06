import { setTimeout as delay } from 'node:timers/promises';
import { ConsumerRequestSchema, ConsumerResponseSchema } from './consumersProtocol';
import type { ConsumerRequest, ConsumerResponse } from './consumersProtocol';
import { readProbeResponse } from './probeRead';

export function createFileConsumerClient(options: { baseUrl: string; token: string; timeoutMs?: number; fetch?: (input: URL, init: RequestInit) => Promise<Response> }) {
  const endpoint = new URL('/consumers', options.baseUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || options.token.length < 32) throw new Error('Invalid consumer source configuration');
  const request = options.fetch ?? globalThis.fetch;
  const observe = async (raw: ConsumerRequest, signal?: AbortSignal): Promise<ConsumerResponse> => {
    const input = ConsumerRequestSchema.parse(raw);
    const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(options.timeoutMs ?? 15_000)]);
    // Bun's timeout must stay observed across response bodies and process-churn retries.
    const observeDeadline = () => {}; deadline.addEventListener('abort', observeDeadline, { once: true });
    const wanted = new Set(input.identities.map(({ device, inode }) => `${device}:${inode}`));
    try { for (;;) {
      deadline.throwIfAborted();
      const response = await readProbeResponse(request, endpoint, { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(input) }, deadline);
      if (!response.ok) throw new Error(`Consumer source HTTP ${response.status}`);
      const result = ConsumerResponseSchema.parse(JSON.parse(await boundedReply(response, deadline)));
      deadline.throwIfAborted();
      if (result.consumers.some(({ device, inode }) => !wanted.has(`${device}:${inode}`))) throw new Error('Consumer source returned unrequested file identities');
      if (input.mode === 'observe' && result.complete && (input.source.bootId !== result.bootId || input.source.namespace !== result.namespace)) throw new Error('Consumer source changed its captured identity');
      if (!result.complete && result.blockers.length && result.blockers.every(({ code }) => code === 'process-changed' || code === 'process-unreadable')) {
        await delay(100, undefined, { signal: deadline }); continue;
      }
      return result;
    } } finally { deadline.removeEventListener('abort', observeDeadline); }
  };
  return {
    capture: (identities: ConsumerRequest['identities'], signal?: AbortSignal) => observe({ mode: 'capture', identities }, signal),
    observe: (source: Extract<ConsumerRequest, { mode: 'observe' }>['source'], identities: ConsumerRequest['identities'], signal?: AbortSignal) => observe({ mode: 'observe', source, identities }, signal),
  };
}
async function boundedReply(response: Response, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get('content-length')) > 8_388_608) throw new Error('Consumer source response is oversized');
  if (!response.body) throw new Error('Consumer source response is empty');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 8_388_608) throw new Error('Consumer source response is oversized'); chunks.push(part.value); }
    signal.throwIfAborted();
    return Buffer.concat(chunks).toString('utf8');
  } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
