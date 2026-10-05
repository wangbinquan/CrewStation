import { isIP } from 'node:net';
import { createPodWorkspaceClient, PodWorkspaceResponseSchema } from '@crewstation/filesystem-metrics';
import type { PodWorkspaceResponse } from '@crewstation/filesystem-metrics';
import { Resources } from '@crewstation/k8s';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { jsonHash, precondition } from '@crewstation/kernel';
import { nodeFileConsumerSource, originalNodeProbe } from '../nodeFileConsumers';
import type { NodeConsumerOrigin } from '../nodeFileConsumers';
import { completeRegistryObjects } from '../nativeRegistry/origin';
import { freshPlatformNode } from '../platformPodTermination';

interface Options { namespace: string; port: number; token: string; hostRoot: string; mountPath: string }
interface PodSpec { nodeName?: string; volumes?: Array<{ name: string; emptyDir?: unknown; hostPath?: { path?: string }; }>; containers?: Array<{ name: string;
  env?: Array<{ name: string; value?: string }>; volumeMounts?: Array<{ name: string; mountPath: string; readOnly?: boolean; subPath?: string; subPathExpr?: string }> }> }
type PodOrigin = { uid: string; name: string; namespace: string; specDigest: string; volumes: string[] };
export interface PodWorkspaceHistory {
  version: 1; pod: PodOrigin; node: { uid: string; name: string }; sourceIdentity: string;
  inventory: PodWorkspaceResponse; consumers: NodeConsumerOrigin;
  /** Full original API catalog also identifies native static Pod hashes. */
  nodePods: Array<{ uid: string; nativeUid: string; namespace: string }>;
}
const unavailable = (message: string) => precondition(message, { code: 'native_pod_workspace_unavailable' });
const files = (inventory: PodWorkspaceResponse) => inventory.volumes.flatMap(row => row.files.map(({ device, inode }) => ({ device, inode })));
/** Complete original node catalog, fixed read-only mount and whole-host file
 * consumers. A missing API Pod is deliberately not a producer-exit proof. */
export function nativePodWorkspaceSource(k8s: K8sClient, raw: Options, fetcher: (url: URL, init: RequestInit) => Promise<Response> = fetch) {
  const options = { ...raw }, consumers = nodeFileConsumerSource(k8s, options, fetcher);
  if (options.hostRoot !== '/var/lib/kubelet/pods' || options.mountPath !== '/kubelet-pods') throw unavailable('原 kubelet 根必须来自固定安装');
  const read = async (pod: PodOrigin, node: { uid: string; name: string }, retained?: PodWorkspaceHistory) => {
    const signal = AbortSignal.timeout(60_000), probe = await originalNodeProbe(k8s, options.namespace, node, signal), spec = probe['spec'] as PodSpec;
    const container = spec.containers?.find(row => row.name === 'probe'), mounts = container?.volumeMounts?.filter(row => row.mountPath === options.mountPath);
    const mount = mounts?.[0], volume = spec.volumes?.find(row => row.name === mount?.name);
    if (mounts?.length !== 1 || !mount?.readOnly || mount.subPath || mount.subPathExpr || volume?.hostPath?.path !== options.hostRoot
      || container?.volumeMounts?.some(row => row.mountPath.startsWith(options.mountPath + '/'))
      || container?.env?.filter(row => row.name === 'CS_STORAGE_PROBE_POD_ROOT').length !== 1
      || container.env.find(row => row.name === 'CS_STORAGE_PROBE_POD_ROOT')?.value !== options.mountPath) throw unavailable('原 kubelet 探针不是完整只读挂载');
    const catalog = async () => (await completeRegistryObjects(k8s, Resources.Pod!, undefined, '', signal)).filter(row => (row['spec'] as PodSpec).nodeName === node.name)
      .map(row => { if (!row.metadata.uid || !row.metadata.namespace) throw unavailable('原节点 Pod 目录身份不全');
        const staticUid = row.metadata.annotations?.['kubernetes.io/config.mirror'];
        if (staticUid && (row.metadata.annotations?.['kubernetes.io/config.source'] !== 'file' || row.metadata.namespace !== 'kube-system' || !/^[a-f0-9]{32}$/.test(staticUid))) throw unavailable('原节点静态 Pod 身份不可核实');
        return { uid: row.metadata.uid, nativeUid: staticUid ?? row.metadata.uid, namespace: row.metadata.namespace }; }).sort((a, b) => a.uid.localeCompare(b.uid));
    const nodePods = await catalog(), key = jsonHash({ pod, node }), ip = (probe['status'] as { podIP: string }).podIP;
    const client = createPodWorkspaceClient({ baseUrl: `http://${isIP(ip) === 6 ? '[' + ip + ']' : ip}:${options.port}`, token: options.token, fetch: fetcher });
    const inventory = await client.observe({ key, podUid: pod.uid, volumes: pod.volumes }, signal);
    const known = new Set([...nodePods, ...retained?.nodePods ?? []].map(row => row.nativeUid));
    if (inventory.allPodUids.some(uid => !known.has(uid))) throw unavailable('原节点存在不能独立归属的 kubelet Pod 残留');
    if (retained && (inventory.rootIdentity !== retained.inventory.rootIdentity || inventory.podIdentity && inventory.podIdentity !== retained.inventory.podIdentity
      || inventory.volumes.some(row => row.identity && row.identity !== retained.inventory.volumes.find(original => original.name === row.name)?.identity))) throw unavailable('原 Pod 或 emptyDir 出生已替换');
    const users = retained ? await consumers.observe(retained.consumers, [...files(retained.inventory), ...files(inventory)]) : await consumers.capture(node, files(inventory));
    const checked = await client.observe({ key, podUid: pod.uid, volumes: pod.volumes }, signal);
    const currentPod = await k8s.get(Resources.Pod!, pod.name, pod.namespace, signal), currentProbe = await k8s.get(Resources.Pod!, probe.metadata.name, options.namespace, signal);
    if (checked.revision !== inventory.revision || jsonHash(nodePods) !== jsonHash(await catalog()) || currentPod && (currentPod.metadata.uid !== pod.uid || jsonHash(currentPod['spec']) !== pod.specDigest)
      || !currentProbe || currentProbe.metadata.uid !== probe.metadata.uid || currentProbe.metadata.resourceVersion !== probe.metadata.resourceVersion
      || (await freshPlatformNode(k8s, probe))?.uid !== node.uid) throw unavailable('原节点、Pod 或工作文件在完整读取期间变化');
    const sourceIdentity = jsonHash({ node, probe: users.source.identity, root: inventory.rootIdentity });
    if (retained && retained.sourceIdentity !== sourceIdentity) throw unavailable('原 kubelet 或全部文件消费者来源变化');
    return { version: 1 as const, pod, node, sourceIdentity, inventory: checked, consumers: users.source, nodePods,
      consumerCount: users.count, consumerDigest: users.digest, storageRemaining: inventory.volumes.reduce((count, row) => count + row.files.length, 0), physicalReclamationProven: false as const };
  };
  return { capture: async (original: K8sObject): Promise<PodWorkspaceHistory> => {
    const spec = original['spec'] as PodSpec, node = await freshPlatformNode(k8s, original);
    if (!original.metadata.uid || !original.metadata.namespace || !node) throw unavailable('原 Pod 节点身份不完整');
    const pod: PodOrigin = { uid: original.metadata.uid, name: original.metadata.name, namespace: original.metadata.namespace, specDigest: jsonHash(spec),
      volumes: (spec.volumes ?? []).filter(row => row.emptyDir !== undefined).map(row => row.name).sort() };
    return read(pod, node);
  }, inspect: (original: PodWorkspaceHistory) => { PodWorkspaceResponseSchema.parse(original.inventory); return read(original.pod, original.node, structuredClone(original)); } };
}
