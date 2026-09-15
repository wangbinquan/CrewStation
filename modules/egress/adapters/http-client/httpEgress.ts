import { EGRESS_HTTP_RESPONSE_BYTES } from '@crewstation/contracts';
import type { HttpEgressTransport } from '../../ports/httpEgress';

const hop = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length', 'forwarded'];
function headers(input: HeadersInit, response = false): Headers {
  const result = new Headers(input), nominated = (result.get('connection') ?? '').split(',').map((s) => s.trim().toLowerCase());
  for (const key of [...result.keys()]) if (hop.includes(key) || nominated.includes(key) || key.startsWith('x-forwarded-') || key.startsWith('x-cs-') && key !== 'x-cs-trace-id' || response && ['content-encoding', 'set-cookie'].includes(key)) result.delete(key);
  return result;
}

async function body(response: Response): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!response.body) return null;
  const reader = response.body.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > EGRESS_HTTP_RESPONSE_BYTES) { await reader.cancel(); throw new Error('Egress response exceeds limit'); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(size); let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}

/** 只在白名单裁定后调用；一次发送，不跟随重定向或重发 POST，响应体也在同一期限内。 */
export function fetchHttpEgress(fetchImpl: typeof fetch = fetch): HttpEgressTransport {
  return { send: async (input) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await fetchImpl(input.url, { method: input.method, headers: headers(input.headers),
        ...(input.bodyBase64 === undefined ? {} : { body: Buffer.from(input.bodyBase64, 'base64') }),
        keepalive: false, redirect: 'manual', credentials: 'omit', signal: controller.signal });
      const displayed = headers(response.headers, true);
      if (new TextEncoder().encode(JSON.stringify(Object.fromEntries(displayed))).byteLength > 32768) { await response.body?.cancel(); throw new Error('Egress response headers exceed limit'); }
      return new Response(await body(response), { status: response.status, statusText: response.statusText, headers: displayed });
    } finally { clearTimeout(timer); }
  } };
}
