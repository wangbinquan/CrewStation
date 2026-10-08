import { randomBytes } from 'node:crypto';
import { createFileConsumerClient, createFilesystemMetricsHandler } from '../../../packages/filesystem-metrics';
import type { ConsumerRequest, ConsumerResponse } from '../../../packages/filesystem-metrics';

/** Use the same authenticated, bounded whole-node SDK as the read-only probe.
 * It stays in-process; no writable host endpoint or caller-selected proc root
 * is exposed by this private native host. */
export function nativeRegistryConsumerReader(fetchHandler?: (request: Request) => Promise<Response>) {
  const token = randomBytes(32).toString('hex'), handler = fetchHandler ?? createFilesystemMetricsHandler({ token, roots: { local: '/' } });
  const client = createFileConsumerClient({ baseUrl: 'http://native.invalid', token, fetch: async (url, init) => handler(new Request(url, init)) });
  return async (files: ConsumerRequest['identities'], root: string, signal?: AbortSignal): Promise<ConsumerResponse> => {
    if (root !== '/proc') throw Error('Original Registry consumers require the whole host proc namespace');
    const identities = [...new Map(files.map(row => [row.device + ':' + row.inode + ':' + (row.birthtimeNs ?? ''), row])).values()]; let result: ConsumerResponse | undefined;
    for (let offset = 0; offset < Math.max(1, identities.length); offset += 256) {
      const page = identities.slice(offset, offset + 256), observed = result ? await client.observe({ bootId: result.bootId, namespace: result.namespace }, page, signal) : await client.capture(page, signal);
      result = result ? { ...result, complete: result.complete && observed.complete, consumers: [...result.consumers, ...observed.consumers], blockers: [...result.blockers, ...observed.blockers] } : observed;
    }
    return result!;
  };
}
