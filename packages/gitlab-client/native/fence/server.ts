import { createHash, timingSafeEqual } from 'node:crypto';
import { jsonHash } from '@crewstation/kernel';
import { GitLabNativeInstanceSchema } from '../protocol';
import type { GitLabNativeInstance } from '../protocol';
import { parseGitLabFenceOutput } from './client';
import { GitLabFenceRequestSchema } from './protocol';
import type { GitLabFenceRequest } from './protocol';

export interface GitLabFenceObserver {
  inspect(signal: AbortSignal): Promise<GitLabNativeInstance>;
  fence(request: GitLabFenceRequest, signal: AbortSignal): Promise<string>;
}
const digest = (value: string) => createHash('sha256').update(value).digest();
/** This endpoint performs native mutations. The host must validate the original deletion grant before each call. */
export function createGitLabFenceHandler(options: { token: string; instance: GitLabNativeInstance; observer: GitLabFenceObserver;
  assertGrant(request: GitLabFenceRequest, signal: AbortSignal): Promise<void> }) {
  if (options.token.length < 32 || typeof options.assertGrant !== 'function') throw Error('native-source-fence-grant-required');
  const instance = GitLabNativeInstanceSchema.parse(options.instance), auth = digest('Bearer ' + options.token), observer = options.observer, assertGrant = options.assertGrant;
  let busy = false;
  return async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname !== '/native/gitlab/fence') return new Response(null, { status: 404 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (!timingSafeEqual(digest(request.headers.get('authorization') ?? ''), auth)) return new Response(null, { status: 401 });
    if (busy) return new Response(null, { status: 409 });
    busy = true;
    try {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]), reader = request.body?.getReader(); if (!reader) throw Error('missing-body');
      const chunks: Uint8Array[] = []; let bytes = 0;
      const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
      try { for (;;) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
        if (bytes > 8_388_608) throw Error('request-budget'); chunks.push(part.value); }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
      const query = GitLabFenceRequestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
      const before = GitLabNativeInstanceSchema.parse(await observer.inspect(signal));
      if (jsonHash(before) !== jsonHash(instance)) throw Error('source-instance-changed');
      const sealed = jsonHash(query); await assertGrant(query, signal);
      if (jsonHash(query) !== sealed) throw Error('source-scope-changed');
      signal.throwIfAborted();
      const receipt = parseGitLabFenceOutput(await observer.fence(query, signal), query);
      const after = GitLabNativeInstanceSchema.parse(await observer.inspect(signal));
      if (jsonHash(after) !== jsonHash(instance) || jsonHash({ bootId: receipt.runtime.bootId, namespace: receipt.runtime.namespace }) !== instance.epoch) throw Error('source-instance-changed');
      signal.throwIfAborted(); return Response.json({ before, after, receipt });
    } catch { return new Response(null, { status: request.signal.aborted ? 499 : 503 }); } finally { busy = false; }
  };
}
