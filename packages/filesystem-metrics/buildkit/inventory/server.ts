import { BuildKitInventoryRequestSchema } from './protocol';
import { observeBuildKitInventory } from './inventory';

export async function buildKitInventoryResponse(request: Request, roots: Readonly<Record<string, string>>, timeoutMs: number) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
  const input = BuildKitInventoryRequestSchema.parse(await body(request, signal)), root = roots[input.rootId];
  if (!root) throw Error('Native BuildKit read-only root is unavailable');
  try {
    const result = JSON.stringify(await observeBuildKitInventory(root, input, signal));
    if (Buffer.byteLength(result) > 32 * 1024 * 1024) throw Error('Native BuildKit complete reply exceeded its budget');
    return new Response(result, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch { return Response.json({ error: 'BuildKit native inventory unavailable' }, { status: 503 }); }
}
async function body(request: Request, signal: AbortSignal): Promise<unknown> {
  if (!request.body) throw Error('Native BuildKit read-only request is empty');
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) { signal.throwIfAborted(); const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
      if (size > 1_048_576) throw Error('Native BuildKit read-only request exceeded its budget'); chunks.push(next.value); }
    signal.throwIfAborted(); return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
