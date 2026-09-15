import type { FetchLike } from '../proxy/forward';

const REQUEST_BYTES = 1024 * 1024;

async function encodeBody(input: BodyInit): Promise<string> {
  const reader = new Response(input).body!.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > REQUEST_BYTES) { await reader.cancel(); throw new Error('代理出站请求体最多 1 MiB，本次未发送'); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts).toString('base64');
}

/** 平台服务域按源 Pod 识别本代理；上游凭据只放在本次目标的请求材料中。 */
export function platformEgressFetch(platformApiUrl: string, fetchImpl: FetchLike = (input, init) => fetch(input, init)): FetchLike {
  const base = new URL(platformApiUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('平台 API 地址不合法');
  const endpoint = new URL('/internal/egress/http', base).href;
  return async (url, init) => {
    const bodyBase64 = init?.body === undefined || init.body === null ? undefined : await encodeBody(init.body);
    return fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, method: init?.method ?? 'GET', headers: Object.fromEntries(new Headers(init?.headers)), ...(bodyBase64 === undefined ? {} : { bodyBase64 }) }),
      signal: init?.signal, redirect: 'error', keepalive: false, credentials: 'omit' });
  };
}
