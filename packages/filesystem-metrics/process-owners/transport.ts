import { setTimeout as delay } from 'node:timers/promises';
import { ProcessOwnerRequestSchema, ProcessOwnerResponseSchema } from './protocol';
import type { ProcessOwnerRequest } from './protocol';
import { observeProcessOwners } from './inventory';
import { readProbeResponse } from '../probeRead';

async function body(value: Request | Response, maximum: number, signal: AbortSignal) {
  if (!value.body || Number(value.headers.get('content-length')) > maximum) throw Error('Native process owner transport budget');
  const reader = value.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  try { for (;;) { signal.throwIfAborted(); const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
    if (size > maximum) throw Error('Native process owner transport budget'); chunks.push(next.value); }
    signal.throwIfAborted(); return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
/** Authentication and serialization are supplied by the shared private probe. */
export async function processOwnerHttp(request: Request, root: string, timeoutMs: number) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
  try {
    const query = ProcessOwnerRequestSchema.parse(await body(request, 32_768, signal)), result = JSON.stringify(await observeProcessOwners(root, query, signal));
    if (Buffer.byteLength(result) > 8_388_608) throw Error('Native process owner output budget');
    return new Response(result, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch { return new Response(null, { status: signal.aborted ? 499 : 503 }); }
}
export function createProcessOwnerClient(options: { baseUrl: string; token: string; fetch?: (url: URL, init: RequestInit) => Promise<Response> }) {
  const url = new URL('/process-owners', options.baseUrl), fetcher = options.fetch ?? fetch;
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || options.token.length < 32) throw Error('Original process owner transport installation is incomplete');
  return { observe: async (raw: ProcessOwnerRequest, signal = AbortSignal.timeout(15_000)) => {
    const query = ProcessOwnerRequestSchema.parse(raw), observeDeadline = () => {};
    let originalSource = query.source;
    signal.addEventListener('abort', observeDeadline, { once: true });
    try {
      for (;;) {
      signal.throwIfAborted();
      const response = await readProbeResponse(fetcher, url, { method: 'POST', redirect: 'error', headers: { authorization: 'Bearer ' + options.token, 'content-type': 'application/json' }, body: JSON.stringify(query) }, signal);
      if (!response.ok) throw Error('Original native process owner source is unavailable'); const observed = ProcessOwnerResponseSchema.parse(await body(response, 8_388_608, signal));
      const churn = !observed.complete && observed.blockers.length > 0 && observed.blockers.every(row => row.code === 'process-unreadable' || row.code === 'process-changed');
      if (observed.owners.length !== query.owners.length || new Set(observed.owners.map(row => row.key)).size !== query.owners.length
        || observed.owners.some(row => !query.owners.some(wanted => wanted.key === row.key))
        || (observed.complete || churn) && originalSource && (observed.bootId !== originalSource.bootId || observed.namespace !== originalSource.namespace || observed.cgroupNamespace !== originalSource.cgroupNamespace)) throw Error('Original native process owner response changed its scope or namespace');
      signal.throwIfAborted();
      if (churn) {
        originalSource = ProcessOwnerRequestSchema.parse({ owners: query.owners, source: { bootId: observed.bootId, namespace: observed.namespace, cgroupNamespace: observed.cgroupNamespace } }).source;
        await delay(100, undefined, { signal }); continue;
      }
      return observed;
      }
    } finally { signal.removeEventListener('abort', observeDeadline); }
  } };
}
