import { BuildKitInventoryRequestSchema, BuildKitInventoryResponseSchema, validateBuildKitInventoryQuery } from './protocol';
import type { BuildKitInventoryRequest } from './protocol';

export function createBuildKitInventoryClient(options: { baseUrl: string; token: string; fetch?: (url: URL, init: RequestInit) => Promise<Response> }) {
  const base = new URL(options.baseUrl), token = options.token, fetcher = options.fetch ?? fetch;
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash || token.length < 32) throw Error('Native BuildKit read-only endpoint configuration is incomplete');
  return { observe: async (raw: BuildKitInventoryRequest, callerSignal?: AbortSignal) => {
    const input = BuildKitInventoryRequestSchema.parse(structuredClone(raw)), signal = AbortSignal.any([...(callerSignal ? [callerSignal] : []), AbortSignal.timeout(40_000)]);
    const response = await fetcher(new URL('/buildkit/inventory', base), { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(input), redirect: 'error', signal });
    if (response.status !== 200 || !response.body) { await response.body?.cancel(); throw Error('Native BuildKit original inventory is unavailable'); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
    try {
      for (;;) { signal.throwIfAborted(); const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
        if (size > 33_554_432) throw Error('Native BuildKit complete inventory exceeded its read budget'); chunks.push(next.value); }
      signal.throwIfAborted(); const result = BuildKitInventoryResponseSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
      return validateBuildKitInventoryQuery(input, result);
    } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } };
}
