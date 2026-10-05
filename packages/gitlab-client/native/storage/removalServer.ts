import { createHash, timingSafeEqual } from 'node:crypto';
import { jsonHash } from '@crewstation/kernel';
import { GitLabNativeInstanceSchema } from '../protocol';
import type { GitLabNativeInstance } from '../protocol';
import { GitLabStorageRemovalRequestSchema, parseGitLabStorageRemovalOutput } from './removal';
import type { GitLabStorageRemovalRequest } from './removal';

export interface GitLabStorageRemovalObserver {
  inspect(signal: AbortSignal): Promise<GitLabNativeInstance>;
  remove(request: GitLabStorageRemovalRequest, signal: AbortSignal): Promise<string>;
}
const hash = (value: string) => createHash('sha256').update(value).digest();
/** Both checks are host-owned. Neither a bearer token nor a caller-supplied boolean permits unlinking files. */
export function createGitLabStorageRemovalHandler(options: {
  token: string; instance: GitLabNativeInstance; observer: GitLabStorageRemovalObserver;
  assertGrant(request: GitLabStorageRemovalRequest, signal: AbortSignal): Promise<void>;
  assertStopped(request: GitLabStorageRemovalRequest, signal: AbortSignal): Promise<void>;
}) {
  if (options.token.length < 32 || typeof options.assertGrant !== 'function' || typeof options.assertStopped !== 'function') throw Error('native-source-removal-guards-required');
  const instance = GitLabNativeInstanceSchema.parse(options.instance), auth = hash('Bearer ' + options.token);
  const { observer, assertGrant, assertStopped } = options; let busy = false;
  return async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname !== '/native/gitlab/storage/remove') return new Response(null, { status: 404 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (!timingSafeEqual(hash(request.headers.get('authorization') ?? ''), auth)) return new Response(null, { status: 401 });
    if (busy) return new Response(null, { status: 409 }); busy = true;
    try {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]), reader = request.body?.getReader(); if (!reader) throw Error('missing-body');
      const chunks: Uint8Array[] = []; let bytes = 0;
      const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
      try { for (;;) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
        if (bytes > 8_388_608) throw Error('request-budget'); chunks.push(part.value); }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
      const query = GitLabStorageRemovalRequestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
      const before = GitLabNativeInstanceSchema.parse(await observer.inspect(signal));
      if (jsonHash(before) !== jsonHash(instance) || jsonHash({ bootId: query.original.runtime.bootId, namespace: query.original.runtime.namespace }) !== instance.epoch) throw Error('source-instance-changed');
      const scope = jsonHash(query); await assertGrant(query, signal); await assertStopped(query, signal);
      if (jsonHash(query) !== scope) throw Error('source-scope-changed'); signal.throwIfAborted();
      const receipt = parseGitLabStorageRemovalOutput(await observer.remove(query, signal), query);
      const after = GitLabNativeInstanceSchema.parse(await observer.inspect(signal));
      if (jsonHash(after) !== jsonHash(instance) || jsonHash({ bootId: receipt.runtime.bootId, namespace: receipt.runtime.namespace }) !== instance.epoch) throw Error('source-instance-changed');
      signal.throwIfAborted(); return Response.json({ before, after, receipt });
    } catch { return new Response(null, { status: request.signal.aborted ? 499 : 503 }); } finally { busy = false; }
  };
}
