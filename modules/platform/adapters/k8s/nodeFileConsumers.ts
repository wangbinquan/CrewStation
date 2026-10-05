import { isIP } from 'node:net';
import { createFileConsumerClient } from '@crewstation/filesystem-metrics';
import type { ConsumerRequest } from '@crewstation/filesystem-metrics';
import { Resources } from '@crewstation/k8s';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { jsonHash, precondition } from '@crewstation/kernel';
import { completeRegistryObjects } from './nativeRegistry/origin';
import { freshPlatformNode } from './platformPodTermination';

export interface NodeConsumerOrigin { readonly identity: string; readonly probeUid: string; readonly containerId: string; readonly imageId: string; readonly nodeUid: string; readonly nodeName: string; readonly bootId: string; readonly namespace: string }
interface Spec { hostPID?: boolean; nodeName?: string; containers?: Array<{ name: string; env?: Array<{ name: string; value?: string }>; envFrom?: unknown[]; securityContext?: { runAsUser?: number; readOnlyRootFilesystem?: boolean; allowPrivilegeEscalation?: boolean; capabilities?: { add?: string[] } } }> }
const unavailable = () => precondition('原节点全部文件消费者不可核实，不能把局部 PID 范围当成已退出', { code: 'node_consumers_unavailable' });
export function nodeFileConsumerSource(k8s: K8sClient, raw: { namespace: string; port: number; token: string }, fetcher: (url: URL, init: RequestInit) => Promise<Response> = fetch) {
  const options = { ...raw };
  if (options.token.length < 32 || !Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw unavailable();
  const read = async (rawNode: { uid: string; name: string }, rawIdentities: ConsumerRequest['identities'], rawOriginal?: NodeConsumerOrigin) => {
    const node = { ...rawNode }, identities = rawIdentities.map(row => ({ ...row })), original = rawOriginal ? { ...rawOriginal } : undefined;
    const signal = AbortSignal.timeout(60_000), probe = await originalNodeProbe(k8s, options.namespace, node, signal);
    const address = (probe['status'] as { podIP: string }).podIP;
    const runtime = (probe['status'] as { containerStatuses: Array<{ name: string; containerID: string; imageID: string }> }).containerStatuses.find(row => row.name === 'probe')!;
    const client = createFileConsumerClient({ baseUrl: `http://${isIP(address) === 6 ? '[' + address + ']' : address}:${options.port}`, token: options.token, fetch: (url, init) => fetcher(url, init) });
    let source = original, count = 0; const digests: string[] = [];
    const unique = [...new Map(identities.map(row => [row.device + ':' + row.inode, row])).values()];
    for (let offset = 0; offset < Math.max(1, unique.length); offset += 256) {
      const page = unique.slice(offset, offset + 256);
      const result = source ? await client.observe({ bootId: source.bootId, namespace: source.namespace }, page, signal) : await client.capture(page, signal);
      if (!result.complete || result.blockers.length || (await freshPlatformNode(k8s, probe))?.uid !== node.uid) throw unavailable();
      const current = { probeUid: probe.metadata.uid!, containerId: runtime.containerID, imageId: runtime.imageID, nodeUid: node.uid, nodeName: node.name, bootId: result.bootId, namespace: result.namespace };
      const captured = { ...current, identity: jsonHash(current) };
      if (source && source.identity !== captured.identity) throw unavailable(); source = captured;
      count += result.consumers.length; digests.push(jsonHash(result));
    }
    const current = await k8s.get(Resources.Pod!, probe.metadata.name, options.namespace, signal);
    if (!current || current.metadata.uid !== probe.metadata.uid || current.metadata.resourceVersion !== probe.metadata.resourceVersion || current.metadata.deletionTimestamp) throw unavailable();
    return { source: source!, complete: true as const, count, digest: jsonHash({ source, files: unique, observations: digests }) };
  };
  return { capture: (node: { uid: string; name: string }, identities: ConsumerRequest['identities']) => read(node, identities),
    observe: (source: NodeConsumerOrigin, identities: ConsumerRequest['identities']) => read({ uid: source.nodeUid, name: source.nodeName }, identities, source) };
}
async function originalNodeProbe(k8s: K8sClient, namespace: string, node: { uid: string; name: string }, signal: AbortSignal): Promise<K8sObject> {
  const candidates = (await completeRegistryObjects(k8s, Resources.Pod!, namespace, 'app=cs-storage-probe', signal)).filter(pod => {
    const spec = pod['spec'] as Spec, status = pod['status'] as { podIP?: string; conditions?: Array<{ type: string; status: string }>; containerStatuses?: Array<{ name: string; containerID?: string; imageID?: string; ready?: boolean; state?: { running?: unknown } }> };
    const container = spec.containers?.find(row => row.name === 'probe'), security = container?.securityContext;
    const runtime = status.containerStatuses?.find(row => row.name === 'probe');
    return pod.metadata.uid && !pod.metadata.deletionTimestamp && spec.nodeName === node.name && spec.hostPID === true
      && status.podIP && isIP(status.podIP) && status.conditions?.some(row => row.type === 'Ready' && row.status === 'True')
      && security?.runAsUser === 0 && security.readOnlyRootFilesystem === true && security.allowPrivilegeEscalation === false
      && ['SYS_PTRACE', 'DAC_READ_SEARCH'].every(cap => security.capabilities?.add?.includes(cap))
      && runtime?.ready === true && runtime.state?.running && /^[a-z0-9]+:\/\/[a-f0-9]{64}$/.test(runtime.containerID ?? '') && /^.+@sha256:[a-f0-9]{64}$/.test(runtime.imageID ?? '')
      && !container?.envFrom?.length && !container?.env?.some(row => row.name === 'CS_STORAGE_PROBE_PROC_ROOT');
  });
  if (candidates.length !== 1 || (await freshPlatformNode(k8s, candidates[0]!))?.uid !== node.uid) throw unavailable();
  return candidates[0]!;
}
