import { createHash, timingSafeEqual } from 'node:crypto';
import { jsonHash } from '@crewstation/kernel';
import { GitLabNativeInstanceSchema } from '../protocol';
import type { GitLabNativeInstance } from '../protocol';
import { GitLabStorageRequestSchema, GitLabStorageRootsSchema } from './protocol';
import type { GitLabStorageRequest, GitLabStorageRoots } from './protocol';
import { parseGitLabStorageOutput } from './client';

export interface GitLabStorageObserver {
  inspect(signal: AbortSignal): Promise<GitLabNativeInstance>;
  read(request: GitLabStorageRequest, signal: AbortSignal): Promise<string>;
}
const secret = (value: string) => createHash('sha256').update(value).digest();
async function requestBody(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw Error('missing-body');
  const parts: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > 32_768) throw Error('request-budget'); parts.push(part.value); }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts));
  } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
}
export function createGitLabStorageHandler(options: { token: string; instance: GitLabNativeInstance; roots: GitLabStorageRoots; observer: GitLabStorageObserver }) {
  if (options.token.length < 32) throw Error('native-source-storage-token-required');
  const instance = GitLabNativeInstanceSchema.parse(options.instance), roots = GitLabStorageRootsSchema.parse(options.roots);
  const authorization = secret('Bearer ' + options.token), observer = options.observer; let busy = false;
  return async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname !== '/native/gitlab/storage') return new Response(null, { status: 404 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (!timingSafeEqual(secret(request.headers.get('authorization') ?? ''), authorization)) return new Response(null, { status: 401 });
    if (busy) return new Response(null, { status: 409 }); busy = true;
    try {
      const query = GitLabStorageRequestSchema.parse(JSON.parse(await requestBody(request)));
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]), before = GitLabNativeInstanceSchema.parse(await observer.inspect(signal));
      if (jsonHash(before) !== jsonHash(instance)) throw Error('native-source-storage-instance-changed');
      const inventory = parseGitLabStorageOutput(await observer.read(query, signal), query, roots);
      const after = GitLabNativeInstanceSchema.parse(await observer.inspect(signal));
      if (jsonHash(after) !== jsonHash(instance) || jsonHash({ bootId: inventory.runtime.bootId, namespace: inventory.runtime.namespace }) !== instance.epoch) throw Error('native-source-storage-instance-changed');
      signal.throwIfAborted(); return Response.json({ before, after, inventory });
    } catch { return new Response(null, { status: request.signal.aborted ? 499 : 503 }); } finally { busy = false; }
  };
}
