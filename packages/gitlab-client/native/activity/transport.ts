import { createHash, timingSafeEqual } from 'node:crypto';
import { jsonHash, PlatformError } from '@crewstation/kernel';
import { GitLabNativeInstanceSchema } from '../protocol';
import type { GitLabNativeInstance } from '../protocol';
import { GitLabActivityRequestSchema, GitLabActivityReceiptSchema, GitLabActivityResponseSchema } from './protocol';
import type { GitLabActivityRequest } from './protocol';

export interface GitLabActivityObserver {
  inspect(signal: AbortSignal): Promise<GitLabNativeInstance>;
  read(request: GitLabActivityRequest, signal: AbortSignal): Promise<string>;
}
const unavailable = () => new PlatformError('unavailable', 'GitLab 原请求与全部线程消费者来源不可核实');
const digest = (value: string) => createHash('sha256').update(value).digest();
export function parseGitLabActivityOutput(output: string, request: GitLabActivityRequest) {
  if (Buffer.byteLength(output) > 8_388_608 || output.trim().split('\n').length !== 1 || !output.trim().startsWith('CS_GITLAB_ACTIVITY=')) throw unavailable();
  const receipt = GitLabActivityReceiptSchema.parse(JSON.parse(output.trim().slice('CS_GITLAB_ACTIVITY='.length)));
  const identities = new Set(request.identities.map(row => row.device + ':' + row.inode));
  if (receipt.nativeRevision !== request.original.nativeRevision || receipt.identitiesDigest !== jsonHash(request.identities)
    || receipt.consumers.some(row => !identities.has(row.device + ':' + row.inode))
    || jsonHash({ bootId: receipt.runtime.bootId, namespace: receipt.runtime.namespace }) !== jsonHash({ bootId: request.original.runtime.bootId, namespace: request.original.runtime.namespace })) throw unavailable();
  return receipt;
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
export function createGitLabActivityHandler(options: { token: string; instance: GitLabNativeInstance; observer: GitLabActivityObserver }) {
  if (options.token.length < 32) throw unavailable();
  const auth = digest('Bearer ' + options.token), instance = GitLabNativeInstanceSchema.parse(options.instance), observer = options.observer; let busy = false;
  return async (request: Request) => {
    if (new URL(request.url).pathname !== '/native/gitlab/activity') return new Response(null, { status: 404 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (!timingSafeEqual(digest(request.headers.get('authorization') ?? ''), auth)) return new Response(null, { status: 401 });
    if (busy) return new Response(null, { status: 409 }); busy = true;
    try {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]);
      const query = GitLabActivityRequestSchema.parse(JSON.parse(await bounded(request.body, signal)));
      if (jsonHash({ bootId: query.original.runtime.bootId, namespace: query.original.runtime.namespace }) !== instance.epoch) throw unavailable();
      const before = GitLabNativeInstanceSchema.parse(await observer.inspect(signal));
      if (jsonHash(before) !== jsonHash(instance)) throw unavailable();
      const receipt = parseGitLabActivityOutput(await observer.read(query, signal), query);
      const after = GitLabNativeInstanceSchema.parse(await observer.inspect(signal));
      if (jsonHash(after) !== jsonHash(instance)) throw unavailable();
      signal.throwIfAborted(); return Response.json({ before, after, receipt });
    } catch { return new Response(null, { status: request.signal.aborted ? 499 : 503 }); }
    finally { busy = false; }
  };
}
export function createGitLabActivityClient(options: { baseUrl: string; token: string; instance: GitLabNativeInstance; fetch?: typeof fetch }) {
  const base = new URL(options.baseUrl), token = options.token, instance = GitLabNativeInstanceSchema.parse(options.instance), fetcher = options.fetch ?? fetch;
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/' || token.length < 32) throw unavailable();
  return { observe: async (raw: GitLabActivityRequest, caller?: AbortSignal) => {
    const request = GitLabActivityRequestSchema.parse(raw), encoded = JSON.stringify(request), started = Date.now();
    if (Buffer.byteLength(encoded) > 8_388_608 || jsonHash({ bootId: request.original.runtime.bootId, namespace: request.original.runtime.namespace }) !== instance.epoch) throw unavailable();
    const signal = AbortSignal.any([...(caller ? [caller] : []), AbortSignal.timeout(90_000)]);
    const response = await fetcher(new URL('/native/gitlab/activity', base), { method: 'POST', body: encoded, redirect: 'error', signal,
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } });
    if (!response.ok) { await response.body?.cancel(); throw unavailable(); }
    const result = GitLabActivityResponseSchema.parse(JSON.parse(await bounded(response.body, signal)));
    if (jsonHash(result.before) !== jsonHash(instance) || jsonHash(result.after) !== jsonHash(instance)
      || Date.parse(result.receipt.observedAt) < started - 5000 || Date.parse(result.receipt.observedAt) > Date.now() + 5000) throw unavailable();
    parseGitLabActivityOutput('CS_GITLAB_ACTIVITY=' + JSON.stringify(result.receipt), request); return result;
  } };
}
