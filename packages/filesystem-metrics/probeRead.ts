import { setTimeout as delay } from 'node:timers/promises';

/** Wait only for the probe's exact read-contention response, sharing the caller's original deadline. */
export async function readProbeResponse(request: (url: URL, init: RequestInit) => Promise<Response>, endpoint: URL, init: RequestInit, signal: AbortSignal): Promise<Response> {
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  // Keep cancellation observed for the whole operation, including the gaps between streamed busy replies.
  const cancel = () => { void activeReader?.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try { for (;;) {
    signal.throwIfAborted();
    const response = await request(endpoint, { ...init, signal });
    if (signal.aborted) { void response.body?.cancel().catch(() => {}); signal.throwIfAborted(); }
    if (response.status !== 409 || !response.body) return response;
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    activeReader = reader;
    let body: string;
    try {
      for (;;) {
        signal.throwIfAborted(); const part = await interruptedRead(reader, signal); if (part.done) break;
        size += part.value.byteLength; if (size > 4096) throw Error('Probe contention response exceeded its read budget'); chunks.push(part.value);
      }
      signal.throwIfAborted(); body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    } finally { activeReader = undefined; void reader.cancel().catch(() => {}); reader.releaseLock(); }
    let value: unknown; try { value = JSON.parse(body); } catch { /* Unrecognized conflicts keep their original HTTP failure. */ }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1
      || !('error' in value) || value.error !== 'A measurement is already running') return new Response(body, { status: 409, headers: response.headers });
    await delay(100, undefined, { signal });
  } } finally { signal.removeEventListener('abort', cancel); }
}

function interruptedRead(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): ReturnType<typeof reader.read> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
    const cleanup = () => signal.removeEventListener('abort', abort);
    reader.read().then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
    if (signal.aborted) { cleanup(); reject(signal.reason); }
  });
}
