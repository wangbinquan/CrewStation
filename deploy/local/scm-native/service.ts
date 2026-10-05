import { createHash, timingSafeEqual } from 'node:crypto';
import { createGitLabNativeHandler, createGitLabFootprintHandler, createGitLabActivityHandler, createGitLabFenceHandler,
  createGitLabDestructionHandler, createGitLabStorageRemovalHandler } from '../../../packages/gitlab-client';
import type { GitLabNativeInstance, GitLabStorageRoots, GitLabNativeObserver, GitLabFootprintObserver, GitLabActivityObserver,
  GitLabFenceObserver, GitLabDestructionObserver, GitLabStorageRemovalObserver } from '../../../packages/gitlab-client';
import type { ProjectDeletionContext } from '../../../packages/contracts';
import { nativeGitlabMutationGrants } from './grants';

async function body(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]), reader = request.body?.getReader();
  if (!reader) throw Error('native-source-missing-envelope'); const chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  try { for (;;) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength; if (size > 25_165_824) throw Error('native-source-envelope-budget'); chunks.push(part.value);
  } signal.throwIfAborted(); return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Deployment-owned fixed observers. The SDK payload is unwrapped only inside
 * a validated controller context; no endpoint accepts an actor or shell command. */
export function nativeGitlabService(input: { token: string; instance: GitLabNativeInstance; roots: GitLabStorageRoots;
  native: GitLabNativeObserver; footprint: GitLabFootprintObserver; activity: GitLabActivityObserver;
  fence: GitLabFenceObserver; destruction: GitLabDestructionObserver; removal: GitLabStorageRemovalObserver;
  assertGrant(context: ProjectDeletionContext, signal: AbortSignal): Promise<void>;
}) {
  const guards = nativeGitlabMutationGrants(input);
  const handlers: Record<string, (request: Request) => Promise<Response>> = {
    '/native/gitlab/inventory': createGitLabNativeHandler({ ...input, observer: input.native }),
    '/native/gitlab/footprint': createGitLabFootprintHandler({ ...input, observer: input.footprint }),
    '/native/gitlab/activity': createGitLabActivityHandler({ ...input, observer: input.activity }),
    '/native/gitlab/fence': createGitLabFenceHandler({ ...input, observer: input.fence, assertGrant: guards.fence }),
    '/native/gitlab/destruction': createGitLabDestructionHandler({ ...input, observer: input.destruction,
      assertGrant: guards.destruction, assertStopped: guards.destructionStopped }),
    '/native/gitlab/storage/remove': createGitLabStorageRemovalHandler({ ...input, observer: input.removal,
      assertGrant: guards.removal, assertStopped: guards.removalStopped }),
  };
  const hash = (raw: string) => createHash('sha256').update(raw).digest(), credential = hash('Bearer ' + input.token);
  let mutating = false;
  return async (request: Request) => {
    const path = new URL(request.url).pathname, handler = handlers[path]; if (!handler) return new Response(null, { status: 404 });
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (!timingSafeEqual(credential, hash(request.headers.get('authorization') ?? ''))) return new Response(null, { status: 401 });
    if (!['/native/gitlab/fence', '/native/gitlab/destruction', '/native/gitlab/storage/remove'].includes(path)) return handler(request);
    try {
      const query = await body(request);
      if (path === '/native/gitlab/destruction' && query?.mode === 'observe') return handler(new Request(request, { body: JSON.stringify(query) }));
      if (mutating) return new Response(null, { status: 409 }); mutating = true;
      try { return await guards.run(query, payload => handler(new Request(request, { body: JSON.stringify(payload) }))); }
      finally { mutating = false; }
    } catch { return new Response(null, { status: request.signal.aborted ? 499 : 403 }); }
  };
}
