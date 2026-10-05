/** Pipes can split one UTF-8 frame anywhere. A truncated, extra or oversized
 * frame must never establish or disarm a native pause guardian. */
export async function guardianFrame(reader: ReadableStreamDefaultReader<Uint8Array>, maximum: number, signal: AbortSignal): Promise<string | undefined> {
  const parts: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted();
      if (part.done) { if (size) throw Error('Registry guardian frame is truncated'); return undefined; }
      size += part.value.byteLength; if (size > maximum) throw Error('Registry guardian frame is oversized');
      const end = part.value.indexOf(10);
      if (end >= 0 && end !== part.value.byteLength - 1) throw Error('Registry guardian frame contains extra bytes');
      parts.push(part.value);
      if (end >= 0) return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)).slice(0, -1);
    }
  } finally { signal.removeEventListener('abort', abort); }
}
