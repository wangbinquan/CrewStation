import { jsonHash, PlatformError } from '@crewstation/kernel';
import { GitLabNativeInstanceSchema, GitLabNativeInventorySchema, GitLabNativeRequestSchema, GitLabNativeResponseSchema } from './protocol';
import type { GitLabNativeInstance, GitLabNativeInventory, GitLabNativeRequest } from './protocol';

const unavailable = () => new PlatformError('unavailable', 'GitLab 原生只读来源不可核实');
export function parseGitLabNativeOutput(output: string, request: GitLabNativeRequest): GitLabNativeInventory {
  if (Buffer.byteLength(output) > 8_388_608) throw unavailable();
  const lines = output.trim().split('\n');
  if (lines.length !== 1 || !lines[0]?.startsWith('CS_GITLAB_NATIVE=')) throw unavailable();
  const result = GitLabNativeInventorySchema.parse(JSON.parse(lines[0].slice('CS_GITLAB_NATIVE='.length)));
  if (result.project.id !== request.projectId || result.project.pathWithNamespace !== request.pathWithNamespace
    || request.createdAt !== null && Date.parse(result.project.createdAt) !== Date.parse(request.createdAt)
    || request.tokenIds.some(id => !result.credentials.tokens.some(token => token.id === id))) throw unavailable();
  return result;
}

async function body(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw unavailable();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const result = await reader.read(); if (result.done) break; size += result.value.byteLength;
      if (size > 8_388_608) throw unavailable(); chunks.push(result.value); }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
}

/** The private source must bind the original installation outside the queried Rails process. */
export function createGitLabNativeClient(options: { baseUrl: string; token: string; instance: GitLabNativeInstance; fetch?: typeof fetch }) {
  const base = new URL(options.baseUrl), token = options.token, instance = GitLabNativeInstanceSchema.parse(options.instance), fetcher = options.fetch ?? fetch;
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/' || token.length < 32) throw unavailable();
  return { observe: async (raw: GitLabNativeRequest, caller?: AbortSignal) => {
    const request = GitLabNativeRequestSchema.parse(raw), encoded = JSON.stringify(request), started = Date.now();
    if (Buffer.byteLength(encoded) > 32_768) throw unavailable();
    const response = await fetcher(new URL('/native/gitlab/inventory', base), { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: encoded, redirect: 'error', signal: AbortSignal.any([...(caller ? [caller] : []), AbortSignal.timeout(90_000)]) });
    if (!response.ok) { await response.body?.cancel(); throw unavailable(); }
    const result = GitLabNativeResponseSchema.parse(JSON.parse(await body(response)));
    if (jsonHash(result.before) !== jsonHash(instance) || jsonHash(result.after) !== jsonHash(instance)
      || jsonHash({ bootId: result.inventory.runtime.bootId, namespace: result.inventory.runtime.namespace }) !== instance.epoch
      || Date.parse(result.inventory.observedAt) < started - 5000 || Date.parse(result.inventory.observedAt) > Date.now() + 5000) throw unavailable();
    parseGitLabNativeOutput('CS_GITLAB_NATIVE=' + JSON.stringify(result.inventory), request);
    return result;
  } };
}
