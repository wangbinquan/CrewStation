import { isIP } from 'node:net';
import { createProcessOwnerClient } from '@crewstation/filesystem-metrics';
import type { ProcessOwnerRequest } from '@crewstation/filesystem-metrics';
import { Resources } from '@crewstation/k8s';
import type { K8sClient } from '@crewstation/k8s';
import { jsonHash, precondition } from '@crewstation/kernel';
import { originalNodeProbe } from './nodeFileConsumers';
import type { NodeConsumerOrigin } from './nodeFileConsumers';
import { freshPlatformNode } from './platformPodTermination';
export interface NodeProcessOwnerOrigin extends NodeConsumerOrigin { cgroupNamespace: string }

/** Whole original host process groups, bound to the same installation as
 * retained inode users. Old API disappearance is not an exit receipt. */
export function nodeProcessOwnerSource(k8s: K8sClient, raw: { namespace: string; port: number; token: string }, fetcher: (url: URL, init: RequestInit) => Promise<Response> = fetch) {
  const options = { ...raw }, unavailable = () => precondition('原节点完整进程归属来源不可核实', { code: 'node_process_owners_unavailable' });
  if (options.token.length < 32 || !Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw unavailable();
  const read = async (node: { uid: string; name: string }, rawOwners: ProcessOwnerRequest['owners'], retained?: NodeProcessOwnerOrigin) => {
    const owners = structuredClone(rawOwners), signal = AbortSignal.timeout(60_000), probe = await originalNodeProbe(k8s, options.namespace, node, signal);
    const status = probe['status'] as { podIP: string; containerStatuses: Array<{ name: string; containerID: string; imageID: string }> }, runtime = status.containerStatuses.find(row => row.name === 'probe')!;
    const client = createProcessOwnerClient({ baseUrl: `http://${isIP(status.podIP) === 6 ? '[' + status.podIP + ']' : status.podIP}:${options.port}`, token: options.token, fetch: fetcher });
    let source = retained; const observed = [];
    for (let offset = 0; offset < Math.max(1, owners.length); offset += 128) {
      const result = await client.observe({ owners: owners.slice(offset, offset + 128), ...(source ? { source: { bootId: source.bootId, namespace: source.namespace, cgroupNamespace: source.cgroupNamespace } } : {}) }, signal);
      if (!result.complete || result.blockers.length || (await freshPlatformNode(k8s, probe))?.uid !== node.uid) throw unavailable();
      const body = { probeUid: probe.metadata.uid!, containerId: runtime.containerID, imageId: runtime.imageID, nodeUid: node.uid, nodeName: node.name, bootId: result.bootId, namespace: result.namespace, cgroupNamespace: result.cgroupNamespace };
      const current = { ...body, identity: jsonHash(body) };
      if (source && source.identity !== current.identity) throw unavailable(); source = current; observed.push(result);
    }
    const current = await k8s.get(Resources.Pod!, probe.metadata.name, options.namespace, signal);
    if (!current || current.metadata.uid !== probe.metadata.uid || current.metadata.resourceVersion !== probe.metadata.resourceVersion || current.metadata.deletionTimestamp) throw unavailable();
    const bindings = observed.flatMap(row => row.owners);
    return { source: source!, complete: true as const, owners: bindings, count: bindings.reduce((count, row) => count + row.threads.length, 0), digest: jsonHash({ source, owners, observed }) };
  };
  return { capture: (node: { uid: string; name: string }, owners: ProcessOwnerRequest['owners']) => read(node, owners),
    observe: (source: NodeProcessOwnerOrigin, owners: ProcessOwnerRequest['owners']) => read({ uid: source.nodeUid, name: source.nodeName }, owners, source) };
}
