import { jsonHash, PlatformError } from '@crewstation/kernel';
import { GitLabNativeInstanceSchema } from '../protocol';
import type { GitLabNativeInstance } from '../protocol';
import { GitLabFenceReceiptSchema, GitLabFenceRequestSchema, GitLabFenceResponseSchema, gitLabFenceOrigins } from './protocol';
import type { GitLabFenceRequest, GitLabFenceReceipt } from './protocol';

const unavailable = () => new PlatformError('unavailable', 'GitLab 原生封写回执不可核实');
export function parseGitLabFenceOutput(output: string, raw: GitLabFenceRequest): GitLabFenceReceipt {
  if (Buffer.byteLength(output) > 8_388_608 || !output.trim().startsWith('CS_GITLAB_FENCE=') || output.trim().split('\n').length !== 1) throw unavailable();
  const request = GitLabFenceRequestSchema.parse(raw), receipt = GitLabFenceReceiptSchema.parse(JSON.parse(output.trim().slice('CS_GITLAB_FENCE='.length)));
  if (receipt.requestDigest !== jsonHash(request) || jsonHash(gitLabFenceOrigins(receipt)) !== jsonHash(gitLabFenceOrigins(request))) throw unavailable();
  return receipt;
}
export function createGitLabFenceClient(options: { baseUrl: string; token: string; instance: GitLabNativeInstance; fetch?: typeof fetch }) {
  const base = new URL(options.baseUrl), token = options.token, instance = GitLabNativeInstanceSchema.parse(options.instance), fetcher = options.fetch ?? fetch;
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/' || token.length < 32) throw unavailable();
  return { fence: async (raw: GitLabFenceRequest, caller?: AbortSignal) => {
    const request = GitLabFenceRequestSchema.parse(raw), encoded = JSON.stringify(request), started = Date.now();
    if (Buffer.byteLength(encoded) > 8_388_608) throw unavailable();
    const signal = AbortSignal.any([...(caller ? [caller] : []), AbortSignal.timeout(90_000)]);
    const response = await fetcher(new URL('/native/gitlab/fence', base), { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: encoded, redirect: 'error', signal });
    if (!response.ok) { await response.body?.cancel(); throw unavailable(); }
    const reader = response.body?.getReader(); if (!reader) throw unavailable();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > 8_388_608) throw unavailable(); chunks.push(part.value); }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
    const result = GitLabFenceResponseSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
    if (jsonHash(result.before) !== jsonHash(instance) || jsonHash(result.after) !== jsonHash(instance)
      || jsonHash({ bootId: result.receipt.runtime.bootId, namespace: result.receipt.runtime.namespace }) !== instance.epoch
      || Date.parse(result.receipt.observedAt) < started - 5000 || Date.parse(result.receipt.observedAt) > Date.now() + 5000) throw unavailable();
    parseGitLabFenceOutput('CS_GITLAB_FENCE=' + JSON.stringify(result.receipt), request);
    return result;
  } };
}
