import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { boundedFileConsumerReply } from './consumerClient';
import { ConsumerRequestSchema, ConsumerResponseSchema } from './consumersProtocol';
import { readProbeResponse } from './probeRead';

export const NodeFileConsumerOriginSchema = z.strictObject({ identity: z.string().regex(/^[a-f0-9]{64}$/), probeUid: z.uuid(),
  containerId: z.string().regex(/^[a-z0-9]+:\/\/[a-f0-9]{64}$/), imageId: z.string().regex(/^.+@sha256:[a-f0-9]{64}$/),
  nodeUid: z.uuid(), nodeName: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,252}$/),
  bootId: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/), namespace: z.string().regex(/^pid:\[[1-9][0-9]*\]$/).max(80) });
export const NodeFileConsumerRequestSchema = z.strictObject({ origin: NodeFileConsumerOriginSchema, identities: ConsumerRequestSchema.options[0].shape.identities });
export const NodeFileConsumerResponseSchema = z.strictObject({ originIdentity: z.string().regex(/^[a-f0-9]{64}$/), identitiesDigest: z.string().regex(/^[a-f0-9]{64}$/), observation: ConsumerResponseSchema });
export type NodeFileConsumerOrigin = z.infer<typeof NodeFileConsumerOriginSchema>;
export type NodeFileConsumerRequest = z.infer<typeof NodeFileConsumerRequestSchema>;
export type NodeFileConsumerResponse = z.infer<typeof NodeFileConsumerResponseSchema>;
export const nodeFileConsumerRequestDigest = (identities: NodeFileConsumerRequest['identities']) => createHash('sha256').update(JSON.stringify(identities)).digest('hex');

/** The private whole-host observer supplements the pinned read-only probe;
 * every reply binds the unchanged probe birth and the complete file tuples. */
export function createNodeFileConsumerClient(options: { baseUrl: string; token: string; timeoutMs?: number; fetch?: (url: URL, init: RequestInit) => Promise<Response> }) {
  const base = new URL(options.baseUrl), endpoint = new URL('/native/registry/file-consumers', base);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash || options.token.length < 32) throw Error('Invalid node consumer source configuration');
  const request = options.fetch ?? globalThis.fetch;
  return { observe: async (raw: NodeFileConsumerRequest, signal?: AbortSignal) => {
    const input = NodeFileConsumerRequestSchema.parse(raw), wanted = new Set(input.identities.map(row => row.device + ':' + row.inode));
    const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(options.timeoutMs ?? 60_000)]);
    const observeDeadline = () => {}; deadline.addEventListener('abort', observeDeadline, { once: true });
    try { for (;;) {
      deadline.throwIfAborted();
      const response = await readProbeResponse(request, endpoint, { method: 'POST', redirect: 'error', headers: { authorization: 'Bearer ' + options.token, 'content-type': 'application/json' }, body: JSON.stringify(input) }, deadline);
      if (!response.ok) throw Error('Node consumer source HTTP ' + response.status);
      const result = NodeFileConsumerResponseSchema.parse(JSON.parse(await boundedFileConsumerReply(response, deadline))), observation = result.observation;
      deadline.throwIfAborted();
      if (result.originIdentity !== input.origin.identity || result.identitiesDigest !== nodeFileConsumerRequestDigest(input.identities)
        || observation.bootId !== input.origin.bootId || observation.namespace !== input.origin.namespace
        || observation.consumers.some(row => !wanted.has(row.device + ':' + row.inode))) throw Error('Node consumer source changed its original identity or file scope');
      if (!observation.complete && observation.blockers.length && observation.blockers.every(row => row.code === 'process-changed' || row.code === 'process-unreadable')) {
        await delay(100, undefined, { signal: deadline }); continue;
      }
      return observation;
    } } finally { deadline.removeEventListener('abort', observeDeadline); }
  } };
}
