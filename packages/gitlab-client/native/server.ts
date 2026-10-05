import { createHash, timingSafeEqual } from 'node:crypto';
import { jsonHash } from '@crewstation/kernel';
import { parseGitLabNativeOutput } from './client';
import { GitLabNativeInstanceSchema, GitLabNativeRequestSchema } from './protocol';
import type { GitLabNativeInstance, GitLabNativeRequest } from './protocol';

export interface GitLabNativeObserver {
  inspect(signal: AbortSignal): Promise<GitLabNativeInstance>;
  read(request: GitLabNativeRequest, signal: AbortSignal): Promise<string>;
}
const secretHash = (value: string) => createHash('sha256').update(value).digest();
async function requestBody(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw Error('missing-body');
  const parts: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length;
      if (bytes > 32_768) throw Error('request-budget'); parts.push(part.value); }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts));
  } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
}

/** A private read endpoint; it cannot archive, revoke, delete, or certify physical reclamation. */
export function createGitLabNativeHandler(options: { token: string; instance: GitLabNativeInstance; observer: GitLabNativeObserver }) {
  if (options.token.length < 32) throw Error('native-source-token-required');
  const expected = GitLabNativeInstanceSchema.parse(options.instance), authorization = secretHash('Bearer ' + options.token), observer = options.observer;
  let busy = false;
  return async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname !== '/native/gitlab/inventory') return new Response(null, { status: 404 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (!timingSafeEqual(secretHash(request.headers.get('authorization') ?? ''), authorization)) return new Response(null, { status: 401 });
    if (busy) return new Response(null, { status: 409 });
    busy = true;
    try {
      const query = GitLabNativeRequestSchema.parse(JSON.parse(await requestBody(request)));
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]), before = GitLabNativeInstanceSchema.parse(await observer.inspect(signal));
      if (jsonHash(before) !== jsonHash(expected)) throw Error('source-instance-changed');
      const inventory = parseGitLabNativeOutput(await observer.read(query, signal), query), after = GitLabNativeInstanceSchema.parse(await observer.inspect(signal));
      if (jsonHash(after) !== jsonHash(expected) || jsonHash({ bootId: inventory.runtime.bootId, namespace: inventory.runtime.namespace }) !== expected.epoch) throw Error('source-instance-changed');
      signal.throwIfAborted();
      return Response.json({ before, after, inventory });
    } catch { return new Response(null, { status: request.signal.aborted ? 499 : 503 }); } finally { busy = false; }
  };
}
