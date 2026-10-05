import { PodWorkspaceRequestSchema, PodWorkspaceResponseSchema } from './protocol';
import type { PodWorkspaceRequest, PodWorkspaceResponse } from './protocol';
export function createPodWorkspaceClient(options: { baseUrl: string; token: string; fetch?: (url: URL, init: RequestInit) => Promise<Response> }) {
  const url = new URL('/pod-workspace/inventory', options.baseUrl), request = options.fetch ?? fetch;
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || options.token.length < 32) throw Error('Native kubelet workspace source transport is incomplete');
  return { observe: async (raw: PodWorkspaceRequest, signal = AbortSignal.timeout(30_000)): Promise<PodWorkspaceResponse> => {
    const input = PodWorkspaceRequestSchema.parse(raw), response = await request(url, { method: 'POST', redirect: 'error', signal, headers: { authorization: 'Bearer ' + options.token, 'content-type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > 67_108_864) throw Error('Native kubelet workspace source response is unavailable');
    const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
    try { for (;;) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > 67_108_864) throw Error('Native kubelet workspace source exceeded complete response budget'); parts.push(part.value); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const result = PodWorkspaceResponseSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))));
    if (result.key !== input.key || result.podUid !== input.podUid || JSON.stringify(result.volumes.map(row => row.name).sort()) !== JSON.stringify([...input.volumes].sort())) throw Error('Native kubelet workspace response changed its original Pod or full volume scope');
    return result;
  } };
}
