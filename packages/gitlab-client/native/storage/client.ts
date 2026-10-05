import { jsonHash, PlatformError } from '@crewstation/kernel';
import { GitLabNativeInstanceSchema } from '../protocol';
import type { GitLabNativeInstance } from '../protocol';
import { GitLabStorageInventorySchema, GitLabStorageRequestSchema, GitLabStorageResponseSchema, GitLabStorageRootsSchema } from './protocol';
import type { GitLabStorageInventory, GitLabStorageRequest, GitLabStorageRoots } from './protocol';

const unavailable = () => new PlatformError('unavailable', 'GitLab 原目录只读来源不可核实');
export function parseGitLabStorageOutput(output: string, request: GitLabStorageRequest, roots: GitLabStorageRoots): GitLabStorageInventory {
  if (Buffer.byteLength(output) > 8_388_608) throw unavailable();
  const lines = output.trim().split('\n');
  if (lines.length !== 1 || !lines[0]?.startsWith('CS_GITLAB_STORAGE=')) throw unavailable();
  const result = GitLabStorageInventorySchema.parse(JSON.parse(lines[0].slice('CS_GITLAB_STORAGE='.length)));
  const scope = result.locations.map(({ present: _present, entries: _entries, ...row }) => row);
  if (jsonHash(result.roots) !== jsonHash(roots) || result.requestDigest !== jsonHash(request)
    || jsonHash(scope) !== jsonHash(request.locations)) throw unavailable();
  return result;
}
async function body(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw unavailable();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) { const value = await reader.read(); if (value.done) break; bytes += value.value.byteLength;
      if (bytes > 8_388_608) throw unavailable(); chunks.push(value.value); }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
}

/** Retained locations are observed without consulting the deleted native parent. */
export function createGitLabStorageClient(options: { baseUrl: string; token: string; instance: GitLabNativeInstance; roots: GitLabStorageRoots; fetch?: typeof fetch }) {
  const base = new URL(options.baseUrl), token = options.token, instance = GitLabNativeInstanceSchema.parse(options.instance);
  const roots = GitLabStorageRootsSchema.parse(options.roots), fetcher = options.fetch ?? fetch;
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash || token.length < 32) throw unavailable();
  return { observe: async (raw: GitLabStorageRequest, caller?: AbortSignal) => {
    const request = GitLabStorageRequestSchema.parse(raw), encoded = JSON.stringify(request), start = Date.now();
    if (Buffer.byteLength(encoded) > 32_768) throw unavailable();
    const response = await fetcher(new URL('/native/gitlab/storage', base), { method: 'POST', redirect: 'error', body: encoded,
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      signal: AbortSignal.any([...(caller ? [caller] : []), AbortSignal.timeout(90_000)]) });
    if (!response.ok) { await response.body?.cancel(); throw unavailable(); }
    const result = GitLabStorageResponseSchema.parse(JSON.parse(await body(response)));
    if (jsonHash(result.before) !== jsonHash(instance) || jsonHash(result.after) !== jsonHash(instance)
      || jsonHash({ bootId: result.inventory.runtime.bootId, namespace: result.inventory.runtime.namespace }) !== instance.epoch
      || Date.parse(result.inventory.observedAt) < start - 5000 || Date.parse(result.inventory.observedAt) > Date.now() + 5000) throw unavailable();
    parseGitLabStorageOutput('CS_GITLAB_STORAGE=' + JSON.stringify(result.inventory), request, roots);
    return result;
  } };
}
