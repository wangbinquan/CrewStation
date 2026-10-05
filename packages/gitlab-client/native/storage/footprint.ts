import { createHash, timingSafeEqual } from 'node:crypto';
import { jsonHash, PlatformError } from '@crewstation/kernel';
import { z } from 'zod';
import { GitLabNativeInventorySchema, GitLabNativeInstanceSchema } from '../protocol';
import type { GitLabNativeInventory, GitLabNativeInstance } from '../protocol';
import { GitLabStorageInventorySchema, GitLabStorageRootsSchema } from './protocol';
import type { GitLabStorageRoots, GitLabStorageInventory } from './protocol';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const GitLabFootprintRequestSchema = z.strictObject({ original: GitLabNativeInventorySchema, retained: GitLabStorageInventorySchema.optional() })
  .refine(value => !value.retained || jsonHash(value.retained.roots) === jsonHash(value.original.roots)
    && value.retained.runtime.bootId === value.original.runtime.bootId && value.retained.runtime.namespace === value.original.runtime.namespace);
export const GitLabFootprintSchema = z.strictObject({ version: z.literal(1), nativeRevision: hash, inventory: GitLabStorageInventorySchema });
const responseSchema = z.strictObject({ before: GitLabNativeInstanceSchema, after: GitLabNativeInstanceSchema, footprint: GitLabFootprintSchema });
export type GitLabFootprint = z.infer<typeof GitLabFootprintSchema>;
export interface GitLabFootprintObserver {
  inspect(signal: AbortSignal): Promise<GitLabNativeInstance>;
  read(request: { original: GitLabNativeInventory; retained?: GitLabStorageInventory }, signal: AbortSignal): Promise<string>;
}
const unavailable = () => new PlatformError('unavailable', 'GitLab 完整项目目录来源不可核实');
const digest = (value: string) => createHash('sha256').update(value).digest();

export function parseGitLabFootprintOutput(output: string, original: GitLabNativeInventory): GitLabFootprint {
  if (Buffer.byteLength(output) > 8_388_608 || output.trim().split('\n').length !== 1 || !output.trim().startsWith('CS_GITLAB_FOOTPRINT=')) throw unavailable();
  const footprint = GitLabFootprintSchema.parse(JSON.parse(output.trim().slice('CS_GITLAB_FOOTPRINT='.length)));
  const { inventory } = footprint;
  if (footprint.nativeRevision !== original.nativeRevision || jsonHash(inventory.roots) !== jsonHash(original.roots)
    || jsonHash({ bootId: inventory.runtime.bootId, namespace: inventory.runtime.namespace }) !== jsonHash({ bootId: original.runtime.bootId, namespace: original.runtime.namespace })
    || inventory.requestDigest !== jsonHash({ locations: inventory.locations.map(({ present: _present, entries: _entries, ...location }) => location) })) throw unavailable();
  return footprint;
}
async function bounded(body: ReadableStream<Uint8Array> | null, signal: AbortSignal) {
  const reader = body?.getReader(); if (!reader) throw unavailable();
  const chunks: Uint8Array[] = []; let bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > 8_388_608) throw unavailable(); chunks.push(part.value); }
    signal.throwIfAborted(); return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}
export function createGitLabFootprintHandler(options: { token: string; instance: GitLabNativeInstance; roots: GitLabStorageRoots; observer: GitLabFootprintObserver }) {
  if (options.token.length < 32) throw unavailable();
  const auth = digest('Bearer ' + options.token), instance = GitLabNativeInstanceSchema.parse(options.instance), roots = GitLabStorageRootsSchema.parse(options.roots);
  const observer = options.observer; let busy = false;
  return async (request: Request) => {
    if (new URL(request.url).pathname !== '/native/gitlab/footprint') return new Response(null, { status: 404 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (!timingSafeEqual(digest(request.headers.get('authorization') ?? ''), auth)) return new Response(null, { status: 401 });
    if (busy) return new Response(null, { status: 409 }); busy = true;
    try {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]);
      const query = GitLabFootprintRequestSchema.parse(JSON.parse(await bounded(request.body, signal)));
      if (jsonHash(query.original.roots) !== jsonHash(roots) || jsonHash({ bootId: query.original.runtime.bootId, namespace: query.original.runtime.namespace }) !== instance.epoch) throw unavailable();
      const before = GitLabNativeInstanceSchema.parse(await observer.inspect(signal));
      if (jsonHash(before) !== jsonHash(instance)) throw unavailable();
      const footprint = parseGitLabFootprintOutput(await observer.read(query, signal), query.original);
      const after = GitLabNativeInstanceSchema.parse(await observer.inspect(signal));
      if (jsonHash(after) !== jsonHash(instance)) throw unavailable();
      signal.throwIfAborted(); return Response.json({ before, after, footprint });
    } catch { return new Response(null, { status: request.signal.aborted ? 499 : 503 }); }
    finally { busy = false; }
  };
}
export function createGitLabFootprintClient(options: { baseUrl: string; token: string; instance: GitLabNativeInstance; fetch?: typeof fetch }) {
  const base = new URL(options.baseUrl), token = options.token, instance = GitLabNativeInstanceSchema.parse(options.instance), fetcher = options.fetch ?? fetch;
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/' || token.length < 32) throw unavailable();
  return { observe: async (raw: GitLabNativeInventory, retained?: GitLabStorageInventory, caller?: AbortSignal) => {
    const request = GitLabFootprintRequestSchema.parse({ original: raw, ...(retained ? { retained } : {}) }), encoded = JSON.stringify(request), started = Date.now();
    if (Buffer.byteLength(encoded) > 8_388_608 || jsonHash({ bootId: request.original.runtime.bootId, namespace: request.original.runtime.namespace }) !== instance.epoch) throw unavailable();
    const signal = AbortSignal.any([...(caller ? [caller] : []), AbortSignal.timeout(90_000)]);
    const response = await fetcher(new URL('/native/gitlab/footprint', base), { method: 'POST', body: encoded, redirect: 'error', signal,
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } });
    if (!response.ok) { await response.body?.cancel(); throw unavailable(); }
    const result = responseSchema.parse(JSON.parse(await bounded(response.body, signal)));
    if (jsonHash(result.before) !== jsonHash(instance) || jsonHash(result.after) !== jsonHash(instance)
      || Date.parse(result.footprint.inventory.observedAt) < started - 5000 || Date.parse(result.footprint.inventory.observedAt) > Date.now() + 5000) throw unavailable();
    parseGitLabFootprintOutput('CS_GITLAB_FOOTPRINT=' + JSON.stringify(result.footprint), request.original); return result;
  } };
}
