import { z } from 'zod';
import { jsonHash, PlatformError } from '@crewstation/kernel';
import { GitLabNativeInstanceSchema } from '../protocol';
import type { GitLabNativeInstance } from '../protocol';
import { GitLabStorageInventorySchema, GitLabStorageRequestSchema, GitLabStorageRootsSchema } from './protocol';
import type { GitLabStorageInventory } from './protocol';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const GitLabStorageRemovalRequestSchema = z.strictObject({ original: GitLabStorageInventorySchema }).refine(({ original }) =>
  original.locations.every((row, index) => original.locations.every((other, otherIndex) => index === otherIndex || row.root !== other.root
    || row.relative !== other.relative && !row.relative.startsWith(other.relative + '/') && !other.relative.startsWith(row.relative + '/'))));
export const GitLabStorageRemovalReceiptSchema = z.strictObject({ version: z.literal(1), observedAt: z.iso.datetime({ offset: true }), revision: hash,
  originalRevision: hash, remainingRevision: hash, removedEntries: z.number().int().nonnegative().max(100_000),
  locations: GitLabStorageRequestSchema.shape.locations, roots: GitLabStorageRootsSchema, runtime: GitLabStorageInventorySchema.shape.runtime,
  physicalReclamationProven: z.literal(false), producersClosed: z.literal(false), consumersStopped: z.literal(false),
}).refine(value => value.revision === jsonHash({ originalRevision: value.originalRevision, remainingRevision: value.remainingRevision,
  removedEntries: value.removedEntries, locations: value.locations, roots: value.roots }));
export const GitLabStorageRemovalResponseSchema = z.strictObject({ before: GitLabNativeInstanceSchema, after: GitLabNativeInstanceSchema, receipt: GitLabStorageRemovalReceiptSchema });
export type GitLabStorageRemovalRequest = z.infer<typeof GitLabStorageRemovalRequestSchema>;
export type GitLabStorageRemovalReceipt = z.infer<typeof GitLabStorageRemovalReceiptSchema>;
const unavailable = () => new PlatformError('unavailable', 'GitLab 原留存文件清理回执不可核实');
export function parseGitLabStorageRemovalOutput(output: string, raw: GitLabStorageRemovalRequest) {
  const { original } = GitLabStorageRemovalRequestSchema.parse(raw);
  if (Buffer.byteLength(output) > 8_388_608 || !output.trim().startsWith('CS_GITLAB_REMOVAL=') || output.trim().split('\n').length !== 1) throw unavailable();
  const receipt = GitLabStorageRemovalReceiptSchema.parse(JSON.parse(output.trim().slice('CS_GITLAB_REMOVAL='.length)));
  const locations = original.locations.map(({ key, root, relative, mode }) => ({ key, root, relative, mode }));
  if (receipt.originalRevision !== original.revision || jsonHash(receipt.roots) !== jsonHash(original.roots) || jsonHash(receipt.locations) !== jsonHash(locations)
    || receipt.removedEntries > original.locations.reduce((count, row) => count + row.entries.length, 0)
    || receipt.remainingRevision !== jsonHash({ roots: original.roots, locations: locations.map(row => ({ ...row, present: false, entries: [] })) })) throw unavailable();
  return receipt;
}
export function createGitLabStorageRemovalClient(options: { baseUrl: string; token: string; instance: GitLabNativeInstance; fetch?: typeof fetch }) {
  const base = new URL(options.baseUrl), token = options.token, instance = GitLabNativeInstanceSchema.parse(options.instance), fetcher = options.fetch ?? fetch;
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/' || token.length < 32) throw unavailable();
  return { remove: async (inventory: GitLabStorageInventory, caller?: AbortSignal) => {
    const request = GitLabStorageRemovalRequestSchema.parse({ original: inventory }), encoded = JSON.stringify(request), started = Date.now();
    if (Buffer.byteLength(encoded) > 8_388_608 || jsonHash({ bootId: request.original.runtime.bootId, namespace: request.original.runtime.namespace }) !== instance.epoch) throw unavailable();
    const response = await fetcher(new URL('/native/gitlab/storage/remove', base), { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: encoded, redirect: 'error', signal: AbortSignal.any([...(caller ? [caller] : []), AbortSignal.timeout(90_000)]) });
    if (!response.ok) { await response.body?.cancel(); throw unavailable(); }
    const reader = response.body?.getReader(); if (!reader) throw unavailable();
    const chunks: Uint8Array[] = []; let bytes = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > 8_388_608) throw unavailable(); chunks.push(part.value); }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
    const result = GitLabStorageRemovalResponseSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
    if (jsonHash(result.before) !== jsonHash(instance) || jsonHash(result.after) !== jsonHash(instance)
      || jsonHash({ bootId: result.receipt.runtime.bootId, namespace: result.receipt.runtime.namespace }) !== instance.epoch
      || Date.parse(result.receipt.observedAt) < started - 5000 || Date.parse(result.receipt.observedAt) > Date.now() + 5000) throw unavailable();
    parseGitLabStorageRemovalOutput('CS_GITLAB_REMOVAL=' + JSON.stringify(result.receipt), request); return result;
  } };
}
