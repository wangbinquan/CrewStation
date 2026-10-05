import { basename, dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import { observeFilesystemSource } from '../../../packages/filesystem-metrics';
import type { RegistryDeletionHistory } from '../../../packages/filesystem-metrics';
import { Resources } from '../../../packages/k8s';
import type { K8sClient, K8sObject } from '../../../packages/k8s';
import { jsonHash } from '../../../packages/kernel';

const hash = z.string().regex(/^[a-f0-9]{64}$/), name = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,252}$/);
export const RegistryNativeOriginSchema = z.strictObject({ namespaceUid: z.uuid(), serviceUid: z.uuid(), podUid: z.uuid(), containerId: z.string().regex(/^containerd:\/\/[a-f0-9]{64}$/), imageId: z.string().regex(/^.+@sha256:[a-f0-9]{64}$/),
  nodeUid: z.uuid(), nodeName: name, pvcUid: z.uuid(), pvUid: z.uuid(), providerPath: z.string().min(1), mountPath: z.string().min(1), rootEpoch: hash, volumeEpoch: hash, probeUid: z.uuid() });
export const RegistryNativeInstallationSchema = z.strictObject({ namespace: name, service: name, pod: name, pvc: name, pv: name, probe: name, container: name, root: z.string().min(1), origin: RegistryNativeOriginSchema,
  pins: z.array(z.strictObject({ kind: z.enum(['Namespace', 'Service', 'Pod', 'PersistentVolumeClaim', 'PersistentVolume', 'Node']), name, namespace: name.optional(), uid: z.uuid(), specIdentity: hash })).length(7) });
export type RegistryNativeInstallation = z.infer<typeof RegistryNativeInstallationSchema>;
const material = (installation: Omit<RegistryNativeInstallation, 'pins'>) => [
  ['Namespace', installation.namespace, undefined, installation.origin.namespaceUid], ['Service', installation.service, installation.namespace, installation.origin.serviceUid],
  ['Pod', installation.pod, installation.namespace, installation.origin.podUid], ['PersistentVolumeClaim', installation.pvc, installation.namespace, installation.origin.pvcUid],
  ['PersistentVolume', installation.pv, undefined, installation.origin.pvUid], ['Pod', installation.probe, installation.namespace, installation.origin.probeUid], ['Node', installation.origin.nodeName, undefined, installation.origin.nodeUid],
] as const;
/** Installation binds full original specs once. Ready/EndpointSlice condition
 * changes caused by the bounded pause do not impersonate a new installation;
 * runtime births, full mounts, selectors, node heartbeat and file epochs do. */
export async function captureRegistryNativeInstallation(k8s: K8sClient, raw: Omit<RegistryNativeInstallation, 'pins'>, signal: AbortSignal) {
  const input = structuredClone(raw), pins = [];
  for (const [kind, name, namespace, uid] of material(input)) {
    const object = await k8s.get(Resources[kind]!, name, namespace, signal);
    if (!object || object.metadata.uid !== uid || object.metadata.deletionTimestamp) throw Error('Registry installation changed before the native host was pinned');
    pins.push({ kind, name, ...(namespace ? { namespace } : {}), uid, specIdentity: jsonHash(object['spec'] ?? {}) });
  }
  return RegistryNativeInstallationSchema.parse({ ...input, pins });
}
export function registryNativeSourceValidator(k8s: K8sClient, raw: RegistryNativeInstallation, readSource: typeof observeFilesystemSource = observeFilesystemSource) {
  const input = RegistryNativeInstallationSchema.parse(structuredClone(raw)), expected = material(input);
  if (!isAbsolute(input.root) || dirname(input.origin.providerPath) !== input.root || !isAbsolute(input.origin.mountPath)
    || new Set(input.pins.map(row => [row.kind, row.namespace ?? '', row.name].join(':'))).size !== 7
    || expected.some(([kind, name, namespace, uid]) => !input.pins.some(row => row.kind === kind && row.name === name && row.namespace === namespace && row.uid === uid))) throw Error('Registry native fixed installation is incomplete');
  const inspect = async (history: RegistryDeletionHistory, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (history.sourceIdentity !== jsonHash(input.origin) || jsonHash(history.origin) !== jsonHash(input.origin) || history.query.directory !== basename(input.origin.providerPath)
      || history.original.rootIdentity !== input.origin.rootEpoch || history.original.volumeIdentity !== input.origin.volumeEpoch) throw Error('Registry retained source is another installation');
    const originals: K8sObject[] = [];
    for (const pin of input.pins) {
      const object = await k8s.get(Resources[pin.kind]!, pin.name, pin.namespace, signal);
      if (!object || object.metadata.uid !== pin.uid || object.metadata.deletionTimestamp || jsonHash(object['spec'] ?? {}) !== pin.specIdentity) throw Error('Registry original native object or mount was replaced');
      originals.push(object);
    }
    const pod = originals.find(row => row.kind === 'Pod' && row.metadata.uid === input.origin.podUid)!, status = pod['status'] as { containerStatuses?: Array<{ name: string; containerID?: string; imageID?: string; state?: { running?: unknown } }> };
    const runtime = status.containerStatuses?.find(row => row.name === input.container);
    if (!runtime?.state?.running || runtime.containerID !== input.origin.containerId || runtime.imageID !== input.origin.imageId) throw Error('Registry original runtime exited or was replaced');
    const node = originals.find(row => row.kind === 'Node')!, lease = await k8s.get({ apiVersion: 'coordination.k8s.io/v1', kind: 'Lease', plural: 'leases', namespaced: true }, input.origin.nodeName, 'kube-node-lease', signal);
    const leaseSpec = lease?.['spec'] as { renewTime?: string; holderIdentity?: string } | undefined, age = Date.now() - Date.parse(leaseSpec?.renewTime ?? '');
    if (!(node['status'] as { conditions?: Array<{ type: string; status: string }> }).conditions?.some(row => row.type === 'Ready' && row.status === 'True')
      || leaseSpec?.holderIdentity !== input.origin.nodeName || !Number.isFinite(age) || age < -5000 || age > 40_000 || !lease?.metadata.ownerReferences?.some(row => row.kind === 'Node' && row.uid === input.origin.nodeUid)) throw Error('Registry original node heartbeat is unavailable');
    const source = await readSource(input.root, { key: 'registry-native-source', rootId: 'local', directory: history.query.directory, entries: [{ key: 'registry', relativePath: 'docker/registry/v2', kind: 'directory' }] }, signal);
    if (source.rootIdentity !== input.origin.rootEpoch || source.volumeIdentity !== input.origin.volumeEpoch) throw Error('Registry original native root or volume was replaced');
    signal.throwIfAborted();
  };
  return inspect;
}
