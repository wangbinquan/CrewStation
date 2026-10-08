import { NodeFileConsumerRequestSchema, NodeFileConsumerResponseSchema, nodeFileConsumerRequestDigest } from '../../../packages/filesystem-metrics';
import type { NodeFileConsumerRequest, NodeFileConsumerResponse } from '../../../packages/filesystem-metrics';
import { Resources } from '../../../packages/k8s';
import type { K8sClient, K8sObject } from '../../../packages/k8s';
import { jsonHash } from '../../../packages/kernel';
import { nativeRegistryConsumerReader } from './consumers';
import { RegistryNativeInstallationSchema, registryNativeInstallationValidator } from './source';
import type { RegistryNativeInstallation } from './source';
import type { RegistryProcessIdentity } from './process/identity';

/** Fixed whole-node Linux host and unchanged original probe. Neither the
 * request nor this route can select a proc root, PID or destructive action. */
export function nativeRegistryNodeConsumers(k8s: K8sClient, raw: RegistryNativeInstallation, process: RegistryProcessIdentity,
  reader = nativeRegistryConsumerReader()) {
  const installation = RegistryNativeInstallationSchema.parse(structuredClone(raw)), inspect = registryNativeInstallationValidator(k8s, installation);
  const original = { ...process };
  if (original.podUid !== installation.origin.podUid || original.containerId !== installation.origin.containerId) throw Error('Node consumer host installation changed');
  return async (rawRequest: NodeFileConsumerRequest, signal: AbortSignal): Promise<NodeFileConsumerResponse> => {
    const request = NodeFileConsumerRequestSchema.parse(rawRequest), { identity, ...source } = request.origin;
    if (identity !== jsonHash(source) || source.nodeUid !== installation.origin.nodeUid || source.nodeName !== installation.origin.nodeName
      || source.probeUid !== installation.origin.probeUid || source.bootId !== original.bootId || source.namespace !== original.namespace) throw Error('Node consumer original host identity changed');
    const probe = async () => {
      await inspect(signal);
      const pod = await k8s.get(Resources.Pod!, installation.probe, installation.namespace, signal);
      assertProbe(pod, request);
      return pod!;
    };
    const before = await probe(), observation = await reader(request.identities, '/proc', signal), after = await probe();
    if (!before.metadata.resourceVersion || !after.metadata.resourceVersion
      || observation.bootId !== source.bootId || observation.namespace !== source.namespace) throw Error('Node consumer observed another host namespace');
    signal.throwIfAborted();
    return NodeFileConsumerResponseSchema.parse({ originIdentity: identity, identitiesDigest: nodeFileConsumerRequestDigest(request.identities), observation });
  };
}
function assertProbe(pod: K8sObject | null, request: NodeFileConsumerRequest) {
  const status = pod?.['status'] as { conditions?: Array<{ type: string; status: string }>; containerStatuses?: Array<{ name: string; ready?: boolean; containerID?: string; imageID?: string; state?: { running?: unknown } }> } | undefined;
  const runtime = status?.containerStatuses?.find(row => row.name === 'probe');
  if (!pod || pod.metadata.uid !== request.origin.probeUid || pod.metadata.deletionTimestamp
    || !status?.conditions?.some(row => row.type === 'Ready' && row.status === 'True') || !runtime?.ready || !runtime.state?.running
    || runtime.containerID !== request.origin.containerId || runtime.imageID !== request.origin.imageId) throw Error('Node consumer original probe runtime changed');
}
