import { timingSafeEqual } from 'node:crypto';
import { MeasurementRequestSchema } from './protocol';
import type { MeasurementResponse } from './protocol';
import { measureDirectory } from './measure';

export function createFilesystemMetricsHandler(options: { token: string; roots: Record<string, string>; timeoutMs?: number }) {
  if (options.token.length < 32) throw new Error('A dedicated measurement token of at least 32 characters is required');
  const credential = Buffer.from(`Bearer ${options.token}`); let busy = false;
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === '/healthz' && request.method === 'GET') return Response.json({ ok: true });
    const supplied = Buffer.from(request.headers.get('authorization') ?? '');
    if (credential.length !== supplied.length || !timingSafeEqual(credential, supplied)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (path !== '/measure' || request.method !== 'POST') return new Response(null, { status: 404 });
    if (busy) return Response.json({ error: 'A measurement is already running' }, { status: 409 });
    if (Number(request.headers.get('content-length')) > 16_384) return new Response(null, { status: 413 });
    busy = true;
    try {
      const body = await boundedBody(request), parsed = MeasurementRequestSchema.safeParse(JSON.parse(body));
      if (!parsed.success) return Response.json({ error: 'Invalid measurement targets' }, { status: 400 });
      const items: MeasurementResponse['items'] = [], requestSignal = AbortSignal.any([request.signal, AbortSignal.timeout(55_000)]);
      for (const target of parsed.data.targets) {
        const start = Date.now();
        try {
          const root = options.roots[target.rootId]; if (!root) throw new Error('Unknown root');
          const allocatedBytes = await measureDirectory(root, target.relativePath, AbortSignal.any([requestSignal, AbortSignal.timeout(options.timeoutMs ?? 10_000)]));
          items.push({ key: target.key, allocatedBytes, observedAt: new Date().toISOString(), durationMs: Date.now() - start, state: 'fresh' });
        } catch (error) { items.push({ key: target.key, observedAt: new Date().toISOString(), durationMs: Date.now() - start, state: 'error', reason: errorCode(error) }); }
      }
      return Response.json({ items });
    } catch { return Response.json({ error: 'Invalid or oversized measurement request' }, { status: 400 }); }
    finally { busy = false; }
  };
}
function errorCode(error: unknown): string {
  if (error instanceof Error) {
    if ('code' in error) return String(error.code);
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'Measurement timed out or was cancelled';
    return error.message.replace(/\/[^\s]+/g, '[path]').slice(0, 200);
  }
  return 'Directory measurement failed';
}
async function boundedBody(request: Request): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 16_384) throw new Error('Request too large'); chunks.push(part.value); }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel(); reader.releaseLock(); }
}
