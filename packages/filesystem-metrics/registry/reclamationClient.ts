import { z } from 'zod';
import { RegistryInventoryResponseSchema } from './protocol';
import { captureRegistryHistory, registryHistoryIdentity, retainedRegistryQuery } from './retained';
import type { RegistryDeletionHistory } from './retained';
import { registryRequestIdentity } from './protocol';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const RegistryReclamationAcknowledgementSchema = z.strictObject({ kind: z.literal('acknowledged'), historyIdentity: hash,
  removed: z.array(hash), remainingEntries: z.number().int().nonnegative(), remainingExclusiveBlobs: z.number().int().nonnegative(),
  shared: z.array(z.strictObject({ digest: z.string().regex(/^sha256:[a-f0-9]{64}$/), identity: hash, bytes: z.number().int().nonnegative() })),
  inventory: RegistryInventoryResponseSchema, physicalReclamationProven: z.literal(false) });
/** Private acknowledgement only. The caller must re-observe independent native
 * files/consumer identities and its own durable producer fence. */
export function createRegistryReclamationClient(options: { baseUrl: string; token: string; fetch?: (url: URL, init: RequestInit) => Promise<Response> }) {
  const base = new URL(options.baseUrl), token = options.token, fetcher = options.fetch ?? fetch;
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash || token.length < 32) throw Error('Registry native deletion transport configuration is invalid');
  const url = new URL('/native/registry/reclaim', base);
  return { reclaim: async (rawContext: unknown, rawHistory: RegistryDeletionHistory, signal?: AbortSignal) => {
    const context = structuredClone(rawContext), history = captureRegistryHistory(rawHistory);
    const response = await fetcher(new URL(url), { method: 'POST', redirect: 'error', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ context, history }), signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(95_000)]) });
    if (!response.ok) { await response.body?.cancel(); throw Error('Registry native deletion source rejected the original grant'); }
    const result = RegistryReclamationAcknowledgementSchema.parse(JSON.parse(await bounded(response)));
    const currentQuery = { ...history.query, ...retainedRegistryQuery(history), key: result.inventory.key };
    const expected = new Set([...history.original.entries.map(row => row.identity), ...history.original.blobs.map(row => row.identity)]);
    if (result.historyIdentity !== registryHistoryIdentity(history) || result.inventory.requestIdentity !== registryRequestIdentity(currentQuery)
      || result.inventory.rootIdentity !== history.original.rootIdentity || result.inventory.volumeIdentity !== history.original.volumeIdentity
      || new Set(result.removed).size !== result.removed.length || result.removed.some(value => !expected.has(value))
      || result.remainingEntries !== result.inventory.entries.length || result.remainingExclusiveBlobs !== result.inventory.blobs.filter(row => !row.otherRepositories.length).length) throw Error('Registry deletion acknowledgement does not match the original retained scope');
    return result;
  } };
}
async function bounded(response: Response) {
  if (!response.body || Number(response.headers.get('content-length')) > 8_388_608) throw Error('Registry native acknowledgement is empty or oversized');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 8_388_608) throw Error('Registry native acknowledgement exceeded its budget'); chunks.push(part.value); }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
  finally { await reader.cancel(); reader.releaseLock(); }
}
