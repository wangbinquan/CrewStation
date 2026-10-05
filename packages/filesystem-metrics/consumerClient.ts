import { ConsumerRequestSchema, ConsumerResponseSchema } from './consumersProtocol';
import type { ConsumerRequest, ConsumerResponse } from './consumersProtocol';

export function createFileConsumerClient(options: { baseUrl: string; token: string; timeoutMs?: number; fetch?: (input: URL, init: RequestInit) => Promise<Response> }) {
  const endpoint = new URL('/consumers', options.baseUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || options.token.length < 32) throw new Error('Invalid consumer source configuration');
  const request = options.fetch ?? globalThis.fetch;
  const observe = async (raw: ConsumerRequest, signal?: AbortSignal): Promise<ConsumerResponse> => {
    const input = ConsumerRequestSchema.parse(raw);
    const response = await request(endpoint, { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(input), signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(options.timeoutMs ?? 15_000)]) });
    if (!response.ok) throw new Error(`Consumer source HTTP ${response.status}`);
    const result = ConsumerResponseSchema.parse(JSON.parse(await boundedReply(response)));
    const wanted = new Set(input.identities.map(({ device, inode }) => `${device}:${inode}`));
    if (result.consumers.some(({ device, inode }) => !wanted.has(`${device}:${inode}`))) throw new Error('Consumer source returned unrequested file identities');
    if (input.mode === 'observe' && result.complete && (input.source.bootId !== result.bootId || input.source.namespace !== result.namespace)) throw new Error('Consumer source changed its captured identity');
    return result;
  };
  return {
    capture: (identities: ConsumerRequest['identities'], signal?: AbortSignal) => observe({ mode: 'capture', identities }, signal),
    observe: (source: Extract<ConsumerRequest, { mode: 'observe' }>['source'], identities: ConsumerRequest['identities'], signal?: AbortSignal) => observe({ mode: 'observe', source, identities }, signal),
  };
}
async function boundedReply(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > 8_388_608) throw new Error('Consumer source response is oversized');
  if (!response.body) throw new Error('Consumer source response is empty');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 8_388_608) throw new Error('Consumer source response is oversized'); chunks.push(part.value); }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel(); reader.releaseLock(); }
}
