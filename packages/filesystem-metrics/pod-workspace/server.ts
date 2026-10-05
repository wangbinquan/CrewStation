import { createHash, timingSafeEqual } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { observePodWorkspaces } from './inventory';
import { PodWorkspaceRequestSchema } from './protocol';

export function createPodWorkspaceHandler(options: { token: string; root: string }) {
  if (options.token.length < 32 || !isAbsolute(options.root)) throw Error('Native kubelet workspace handler requires its fixed installation');
  const hash = (value: string) => createHash('sha256').update(value).digest(), credential = hash('Bearer ' + options.token), root = options.root;
  return async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname !== '/pod-workspace/inventory') return new Response(null, { status: 404 });
    if (!timingSafeEqual(credential, hash(request.headers.get('authorization') ?? ''))) return new Response(null, { status: 401 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    try {
      if (!request.body || Number(request.headers.get('content-length')) > 16_384) return new Response(null, { status: 413 });
      const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 16_384) throw Error('Native kubelet workspace input budget'); chunks.push(part.value); } }
      finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const query = PodWorkspaceRequestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
      const response = JSON.stringify(await observePodWorkspaces(root, query, signal));
      if (Buffer.byteLength(response) > 67_108_864) throw Error('Native kubelet workspace output budget');
      return new Response(response, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    } catch { return new Response(null, { status: signal.aborted ? 499 : 503 }); }
  };
}
