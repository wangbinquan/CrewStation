import { createHash, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { filesystemSourceEpoch } from '../../source';

const hash = (raw: unknown) => createHash('sha256').update(JSON.stringify(raw)).digest('hex');
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/), nativeHash = z.string().regex(/^[a-f0-9]{64}$/);
const query = z.strictObject({ key: z.string().min(1).max(200), directory: z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,252}$/), digests: z.array(digest).max(10_000) });
const row = z.strictObject({ digest, identity: nativeHash, layers: z.array(digest), children: z.array(digest), config: digest.optional() });
const responseSchema = z.strictObject({ key: z.string(), rootIdentity: nativeHash, volumeIdentity: nativeHash, manifests: z.array(row), identity: nativeHash, complete: z.literal(true) });
const descriptor = z.object({ digest, size: z.number().int().nonnegative() });
const media = new Set(['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json', 'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json']);
const stamp = (s: Awaited<ReturnType<typeof lstat>>) => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':');
/** Read native image manifests by full descriptor EOF and verify their actual
 * bytes. Logs, annotations and arbitrary native content are never returned. */
export async function observeBuildKitManifests(root: string, raw: z.infer<typeof query>, signal = AbortSignal.timeout(30_000)) {
  const input = query.parse(raw), paths = [root, join(root, input.directory)];
  for (const name of ['runc-overlayfs', 'content', 'blobs', 'sha256']) paths.push(join(paths.at(-1)!, name));
  const handles = [];
  try {
    for (const path of paths) handles.push(await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY));
    const births = await Promise.all(handles.map(h => h.stat({ bigint: true }))), manifests = new Map<string, z.infer<typeof row>>(), originals = new Map<string, string>();
    const visit = async (wanted: string, ancestors = new Set<string>()): Promise<void> => {
      signal.throwIfAborted(); if (ancestors.has(wanted) || manifests.size >= 10_000) throw Error('Original native manifest graph is cyclic or oversized'); if (manifests.has(wanted)) return;
      const path = join(paths.at(-1)!, wanted.slice(7)), before = await lstat(path); const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await handle.stat({ bigint: true }); filesystemSourceEpoch(stat, 'file');
        if (!stat.isFile() || stat.nlink !== 1n || stat.size > 8_388_608n || stamp(await handle.stat()) !== stamp(before)) throw Error('Original native manifest birth is invalid');
        const bytes = await handle.readFile(); if (BigInt(bytes.length) !== stat.size || 'sha256:' + createHash('sha256').update(bytes).digest('hex') !== wanted) throw Error('Original native manifest bytes differ from descriptor');
        const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (doc.schemaVersion !== 2 || !media.has(doc.mediaType)) throw Error('Original native descriptor is not a complete supported image manifest');
        const children = doc.manifests ? z.array(descriptor).parse(doc.manifests).map(x => x.digest) : [];
        const layers = doc.manifests ? [] : z.array(descriptor).parse(doc.layers).map(x => x.digest), config = doc.manifests ? undefined : descriptor.parse(doc.config).digest;
        if (stamp(await handle.stat()) !== stamp(before)) throw Error('Original native manifest changed during byte EOF'); originals.set(path, stamp(before));
        manifests.set(wanted, { digest: wanted, identity: filesystemSourceEpoch(stat, 'file'), layers, children, ...(config ? { config } : {}) });
        for (const child of children) await visit(child, new Set([...ancestors, wanted]));
      } finally { await handle.close(); }
    };
    for (const wanted of input.digests) await visit(wanted);
    for (const [path, before] of originals) if (stamp(await lstat(path)) !== before) throw Error('Original native manifest source changed during complete graph observation');
    for (let i = 0; i < paths.length; i++) if (filesystemSourceEpoch(await lstat(paths[i]!, { bigint: true }), 'directory') !== filesystemSourceEpoch(births[i]!, 'directory')) throw Error('Original native manifest directory birth changed');
    const material = { key: input.key, rootIdentity: filesystemSourceEpoch(births[0]!, 'directory'), volumeIdentity: filesystemSourceEpoch(births[1]!, 'directory'), manifests: [...manifests.values()].sort((a, b) => a.digest.localeCompare(b.digest)), complete: true as const };
    return { ...material, identity: hash(material) };
  } finally { await Promise.all(handles.map(h => h.close())); }
}
async function boundedBody(response: Request | Response, maximum: number, signal: AbortSignal) {
  if (!response.body || Number(response.headers.get('content-length')) > maximum) throw Error('Native manifest transport budget');
  const reader = response.body.getReader(), parts = []; let bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  try { for (;;) { signal.throwIfAborted(); const row = await reader.read(); signal.throwIfAborted(); if (row.done) break; bytes += row.value.byteLength; if (bytes > maximum) throw Error('Native manifest transport budget'); parts.push(row.value); }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
const endpoint = '/buildkit/manifests';
export function createBuildKitManifestHandler(options: { root: string; token: string }) {
  const credential = hash('Bearer ' + options.token); if (options.token.length < 32) throw Error('Original native manifest credential is incomplete');
  return async (request: Request) => {
    if (new URL(request.url).pathname !== endpoint) return new Response(null, { status: 404 });
    if (!timingSafeEqual(Buffer.from(credential, 'hex'), Buffer.from(hash(request.headers.get('authorization') ?? ''), 'hex'))) return new Response(null, { status: 401 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    try { const observed = await observeBuildKitManifests(options.root, query.parse(await boundedBody(request, 1_048_576, signal)), signal);
      const body = JSON.stringify(observed); if (Buffer.byteLength(body) > 16_777_216) throw Error('Native manifest output budget'); return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    } catch { return new Response(null, { status: 503 }); }
  };
}
export function createBuildKitManifestClient(options: { baseUrl: string; token: string; fetch?: (url: URL, init: RequestInit) => Promise<Response> }) {
  const url = new URL(endpoint, options.baseUrl), request = options.fetch ?? fetch;
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || options.token.length < 32) throw Error('Original native manifest installation is incomplete');
  return { observe: async (raw: z.infer<typeof query>, signal = AbortSignal.timeout(30_000)) => {
    const input = query.parse(raw), result = await request(url, { method: 'POST', redirect: 'error', signal, headers: { authorization: 'Bearer ' + options.token }, body: JSON.stringify(input) });
    if (!result.ok) throw Error('Original native manifest source is unavailable'); const observed = responseSchema.parse(await boundedBody(result, 16_777_216, signal));
    const { identity, ...material } = observed;
    if (input.key !== observed.key || hash(material) !== identity || new Set(observed.manifests.map(r => r.digest)).size !== observed.manifests.length || input.digests.some(d => !observed.manifests.some(r => r.digest === d))) throw Error('Original native manifest graph or complete roots changed');
    return observed;
  } };
}
