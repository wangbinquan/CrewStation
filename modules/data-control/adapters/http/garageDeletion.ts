import { z } from 'zod';
import { jsonHash, precondition } from '@crewstation/kernel';

const id = z.string().regex(/^[a-f0-9]{64}$/), count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nodeSchema = z.object({ id, garageVersion: z.enum(['2.4.1', 'v2.4.1']), isUp: z.literal(true), draining: z.literal(false), role: z.object({ capacity: count.positive() }) });
const blockSchema = z.object({ blockHash: id, refcount: count, versions: z.array(z.object({ versionId: id, refDeleted: z.boolean(), versionDeleted: z.boolean(), garbageCollected: z.boolean(), backlink: z.unknown().nullable() })).max(9999) });
type Fetcher = (url: URL, init: RequestInit) => Promise<Response>;
/** Normal Garage admin operations only. `PurgeBlocks` clears native references;
 * its acknowledgement never proves that the local block files were removed. */
export function garageDeletionTransport(config: { endpoint: string; token: string }, fetcher: Fetcher = fetch) {
  const base = new URL(config.endpoint), token = config.token;
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash || config.token.length < 32) throw precondition('Garage 原管理来源配置无效');
  const request = async (operation: string, signal: AbortSignal, body?: unknown, query?: Record<string, string>) => {
    const url = new URL('/v2/' + operation, base); for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    const response = await fetcher(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw precondition('Garage 原管理请求未成功'); }
    return JSON.parse(await boundedBody(response)) as unknown;
  };
  const cluster = async (signal: AbortSignal) => {
    const health = z.object({ status: z.literal('healthy'), knownNodes: z.literal(1), connectedNodes: z.literal(1), storageNodes: z.literal(1), storageNodesUp: z.literal(1), partitions: z.literal(256), partitionsAllOk: z.literal(256) }).parse(await request('GetClusterHealth', signal));
    const status = z.object({ nodes: z.array(nodeSchema).length(1) }).parse(await request('GetClusterStatus', signal));
    return { node: status.nodes[0]!.id, revision: jsonHash({ health, nodes: status.nodes.map(row => ({ id: row.id, version: row.garageVersion })) }) };
  };
  const oneNode = <T>(raw: unknown, node: string, shape: z.ZodType<T>) => {
    const reply = z.object({ success: z.record(id, shape), error: z.record(z.string(), z.string()) }).parse(raw);
    if (Object.keys(reply.error).length || Object.keys(reply.success).length !== 1 || !reply.success[node]) throw precondition('Garage 原全部节点回执不完整'); return reply.success[node]!;
  };
  return { cluster,
    bucket: async (alias: string, signal: AbortSignal) => {
      const result = z.object({ id, created: z.string().datetime(), globalAliases: z.array(z.string()) }).parse(await request('GetBucketInfo', signal, undefined, { globalAlias: alias }));
      if (!result.globalAliases.includes(alias)) throw precondition('Garage 原 bucket 别名归属变化'); return { id: result.id, created: result.created };
    },
    purgeExclusive: async (raw: { node: string; hash: string; bucketId: string; spaceIds: readonly string[]; versions: readonly string[]; uploads: readonly string[] }, signal: AbortSignal, authorize: () => Promise<void>) => {
      const input = structuredClone(raw);
      id.parse(input.node); id.parse(input.hash); id.parse(input.bucketId);
      if (!input.spaceIds.length || input.spaceIds.some(value => !z.uuid().safeParse(value).success)) throw precondition('Garage 原对象空间范围无效');
      const current = await cluster(signal); if (current.node !== input.node) throw precondition('Garage 原节点身份变化');
      const info = oneNode(await request('GetBlockInfo', signal, { blockHash: input.hash }, { node: input.node }), input.node, blockSchema);
      if (info.blockHash !== input.hash || info.refcount !== info.versions.filter(row => !row.refDeleted).length
        || info.versions.some(row => !input.versions.includes(row.versionId))) return { kind: 'shared' as const };
      for (const row of info.versions) if (row.backlink !== null) {
        const back = z.record(z.string(), z.unknown()).parse(row.backlink), object = back['object'], upload = back['upload'];
        if (Object.keys(back).length !== 1 || !object && !upload) throw precondition('Garage 原块 back-link 未核实');
        const location = z.object({ bucketId: id, key: z.string(), ...(upload ? { uploadId: id, uploadGarbageCollected: z.literal(false) } : {}) }).parse(object ?? upload);
        if (location.bucketId !== input.bucketId || !input.spaceIds.some(value => location.key.startsWith('spaces/' + value + '/')) || upload && !input.uploads.includes(String((location as { uploadId?: string }).uploadId))) return { kind: 'shared' as const };
      }
      await authorize(); signal.throwIfAborted();
      const reply = oneNode(await request('PurgeBlocks', signal, [input.hash], { node: input.node }), input.node,
        z.object({ blocksPurged: z.literal(1), objectsDeleted: count, uploadsDeleted: count, versionsDeleted: count, blockRefsPurged: count }));
      await authorize(); return { kind: 'acknowledged' as const, digest: jsonHash(reply), physicalReclamationProven: false as const };
    },
  };
}
async function boundedBody(response: Response): Promise<string> {
  if (!response.body || Number(response.headers.get('content-length')) > 4 * 1024 * 1024) throw precondition('Garage 原管理回执超出预算');
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 4 * 1024 * 1024) throw precondition('Garage 原管理回执超出预算'); parts.push(part.value); } return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)); }
  finally { await reader.cancel(); reader.releaseLock(); }
}
