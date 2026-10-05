import { createHash } from 'node:crypto';
import { GarageInventoryRequestSchema, GarageInventoryResponseSchema, garageRequestIdentity } from './protocol';
import type { GarageInventoryRequest } from './protocol';

export function createGarageInventoryClient(options: { baseUrl: string; token: string; timeoutMs?: number; fetch?: (url: URL, init: RequestInit) => Promise<Response> }) {
  const endpoint = new URL('/garage/inventory', options.baseUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || options.token.length < 32) throw Error('garage-native-client-configuration');
  const request = options.fetch ?? globalThis.fetch;
  return { observe: async (raw: GarageInventoryRequest, callerSignal?: AbortSignal) => {
    const input = GarageInventoryRequestSchema.parse(raw), signal = AbortSignal.any([...(callerSignal ? [callerSignal] : []), AbortSignal.timeout(options.timeoutMs ?? 35_000)]);
    const response = await request(endpoint, { method: 'POST', redirect: 'error', headers: { authorization: 'Bearer ' + options.token, 'content-type': 'application/json' }, body: JSON.stringify(input), signal });
    if (!response.ok) throw Error('garage-native-inventory-http-' + response.status);
    const result = GarageInventoryResponseSchema.parse(JSON.parse(await boundedReply(response))), metadata = result.metadata;
    if (result.key !== input.key || result.requestIdentity !== garageRequestIdentity(input)
      || metadata.queryIdentity !== digest(JSON.stringify(input.query)) || metadata.source.rootIdentity !== result.blocks.rootIdentity) throw Error('garage-native-scope-conflict');
    const own = (key: string) => input.query.spaceIds.some(id => key.startsWith('spaces/' + id + '/'));
    if (metadata.objects.some(row => !own(row.key)) || metadata.multipart.some(row => !own(row.key))) throw Error('garage-native-foreign-key');
    for (const ids of [metadata.versions, metadata.uploads, metadata.blocks]) if (new Set(ids).size !== ids.length) throw Error('garage-native-duplicate-id');
    if (new Set(result.blocks.copies.map(row => row.path)).size !== result.blocks.copies.length) throw Error('garage-native-duplicate-copy');
    for (const copy of result.blocks.copies) {
      if (!metadata.blocks.includes(copy.hash) || !copy.path.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && !['.', '..'].includes(part))
        || digest(JSON.stringify(['file', copy.device, copy.inode, copy.birthtimeNs])) !== copy.identity) throw Error('garage-native-copy-conflict');
    }
    return result;
  } };
}
const digest = (raw: string) => createHash('sha256').update(raw).digest('hex');
async function boundedReply(response: Response): Promise<string> {
  if (!response.body || Number(response.headers.get('content-length')) > 32 * 1024 * 1024) throw Error('garage-native-reply-budget');
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 32 * 1024 * 1024) throw Error('garage-native-reply-budget'); parts.push(part.value); }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts));
  } finally { await reader.cancel(); reader.releaseLock(); }
}
