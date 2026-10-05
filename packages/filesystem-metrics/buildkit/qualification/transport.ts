import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { BuildKitInputRequestSchema, observeBuildKitPlatformInputs } from './platformInputs';

const hash = z.string().regex(/^[a-f0-9]{64}$/), path = z.string().min(1).max(8192), digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const files = z.array(z.strictObject({ path, kind: z.enum(['file', 'directory']), digest: digest.optional() })).max(200_000);
const input = z.strictObject({ storageId: z.string().regex(/^[1-9][0-9]*$/), sourceIdentity: hash, files,
  templateFiles: z.array(z.strictObject({ path, digest })).min(1).max(200_000), sharedPlatformContentsProven: z.boolean(),
  projectMatches: z.array(z.strictObject({ repositoryIdentity: hash, commit: z.string().regex(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/), identity: hash })).optional() });
const responseSchema = z.strictObject({ version: z.literal(1), key: z.string(), rootIdentity: hash, volumeIdentity: hash, templateIdentity: hash,
  inputs: z.array(input).min(1).max(128), complete: z.literal(true), identity: hash, physicalReclamationProven: z.literal(false), observedAt: z.iso.datetime() });
const endpoint = '/buildkit/platform-inputs';
const body = async (response: Request | Response, maximum: number, signal: AbortSignal) => {
  if (!response.body || Number(response.headers.get('content-length')) > maximum) throw Error('Native BuildKit input transport budget');
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  try { for (;;) { signal.throwIfAborted(); const next = await reader.read(); signal.throwIfAborted(); if (next.done) break; size += next.value.byteLength;
    if (size > maximum) throw Error('Native BuildKit input complete transport budget'); parts.push(next.value); } return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
};
export function createBuildKitInputHandler(options: { token: string; root: string; templateRoot: string }) {
  if (options.token.length < 32) throw Error('Native BuildKit input credential is incomplete');
  const credential = createHash('sha256').update('Bearer ' + options.token).digest();
  return async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname !== endpoint) return new Response(null, { status: 404 });
    if (!timingSafeEqual(credential, createHash('sha256').update(request.headers.get('authorization') ?? '').digest())) return new Response(null, { status: 401 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    try {
      const query = BuildKitInputRequestSchema.parse(await body(request, 8_388_608, signal)), observed = responseSchema.parse(await observeBuildKitPlatformInputs(options, query, signal));
      const result = JSON.stringify(observed); if (Buffer.byteLength(result) > 67_108_864) throw Error('Native BuildKit input output budget');
      return new Response(result, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    } catch { return new Response(null, { status: signal.aborted ? 499 : 503 }); }
  };
}
export function createBuildKitInputClient(options: { baseUrl: string; token: string; fetch?: (url: URL, init: RequestInit) => Promise<Response> }) {
  const url = new URL(endpoint, options.baseUrl), request = options.fetch ?? fetch;
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || options.token.length < 32) throw Error('Native BuildKit input transport configuration is incomplete');
  return { observe: async (raw: z.infer<typeof BuildKitInputRequestSchema>, signal = AbortSignal.timeout(30_000)) => {
    const input = BuildKitInputRequestSchema.parse(raw), response = await request(url, { method: 'POST', redirect: 'error', signal, headers: { authorization: 'Bearer ' + options.token, 'content-type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.ok) throw Error('Native BuildKit input source is unavailable'); const observed = responseSchema.parse(await body(response, 67_108_864, signal));
    const { identity, physicalReclamationProven: _proof, observedAt: _at, ...material } = observed;
    if (observed.key !== input.key || new Set(observed.inputs.map(row => row.storageId)).size !== input.storageIds.length
      || observed.inputs.some(row => !input.storageIds.includes(row.storageId)) || createHash('sha256').update(JSON.stringify(material)).digest('hex') !== identity) throw Error('Native BuildKit input original identity or complete scope changed');
    return observed;
  } };
}
