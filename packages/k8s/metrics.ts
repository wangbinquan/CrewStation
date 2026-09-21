/** kubelet responses are bounded before decoding. Preserve uint64 counters across JSON. */
export async function boundedMetricsText(response: Response, maxBytes = 16 * 1024 * 1024): Promise<string> {
  if (!response.ok) throw new Error(`Kubelet metrics HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Kubelet metrics response too large');
  if (!response.body) throw new Error('Empty kubelet metrics response');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let bytes = 0, text = '';
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error('Kubelet metrics response too large');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel(); reader.releaseLock(); }
}
export function parseMetricsJson(text: string): unknown {
  return JSON.parse(text, ((_: string, value: unknown, context?: { source?: string }) => {
    if (typeof value === 'number' && !Number.isSafeInteger(value) && context?.source && /^\d+$/.test(context.source)) return context.source;
    return value;
  }) as Parameters<typeof JSON.parse>[1]);
}
