import { isIP } from 'node:net';
import { basename } from 'node:path';
import { createBuildKitControlClient, createBuildKitControlTransport, createBuildKitInventoryClient } from '@crewstation/filesystem-metrics';
import type { BuildKitControlTransport, BuildKitHistoryQuery, BuildKitInventoryRequest } from '@crewstation/filesystem-metrics';
import { Resources } from '@crewstation/k8s';
import type { K8sClient } from '@crewstation/k8s';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import { registryProbe, registryServer } from '../nativeRegistry/origin';
import { freshPlatformNode } from '../platformPodTermination';
import { buildKitSourceOptions, buildKitStorage } from './origin';
import type { BuildKitSourceOptions } from './origin';

export interface BuildKitSourceQuery { files: Pick<BuildKitInventoryRequest, 'storageIds' | 'contentDigests'>; history: BuildKitHistoryQuery }
const address = (ip: string, port: number) => `http://${isIP(ip) === 6 ? '[' + ip + ']' : ip}:${port}`;
async function control(rpc: BuildKitControlTransport, query: BuildKitHistoryQuery, signal: AbortSignal) {
  const client = createBuildKitControlClient(rpc), info = await client.info(signal), workers = await client.workers(signal);
  if (workers.length !== 1 || workers[0]?.revision !== info.revision) throw precondition('原 BuildKit worker 或服务版本不能唯一绑定');
  const usage = await client.diskUsage(signal), histories = await client.historyOwnership(query, signal);
  return { info, worker: workers[0]!, usage, histories };
}
/** Full native gRPC EOF plus all four original databases and selected physical
 * files. Service/EndpointSlice/Pod/image/config/PVC/PV/node/probe are checked
 * again after both reads; none of these observations claims reclamation. */
export function nativeBuildKitSource(k8s: K8sClient, raw: BuildKitSourceOptions, fetcher: typeof fetch = fetch,
  transport: (baseUrl: string) => BuildKitControlTransport = baseUrl => createBuildKitControlTransport({ baseUrl })) {
  const options = buildKitSourceOptions(raw);
  const capture = async (rawQuery: BuildKitSourceQuery, callerSignal?: AbortSignal) => {
    const query = structuredClone(rawQuery), signal = AbortSignal.any([...(callerSignal ? [callerSignal] : []), AbortSignal.timeout(60_000)]);
    const server = await registryServer(k8s, options, signal), volume = await buildKitStorage(k8s, options, server.pod, signal);
    const probe = await registryProbe(k8s, options, server.node.name, signal), podIp = (server.pod['status'] as { podIP: string }).podIP;
    const rpc = transport(address(podIp, options.port)), native = await control(rpc, query.history, signal), started = Date.now();
    const key = jsonHash({ namespace: server.namespace.metadata.uid, service: server.service.metadata.uid, pvc: volume.pvc.metadata.uid, pv: volume.pv.metadata.uid, query });
    const inventory = await createBuildKitInventoryClient({ baseUrl: address(probe.address, options.probePort), token: options.probeToken, fetch: (url, init) => fetcher(url, init) })
      .observe({ key, rootId: 'local', directory: basename(volume.path), ...query.files }, signal);
    if (inventory.workerId !== native.worker.id || Date.parse(inventory.observedAt) < started - 5000 || Date.parse(inventory.observedAt) > Date.now() + 5000) throw precondition('原 BuildKit 文件 worker 或盘点时间不符');
    const checkedNative = await control(rpc, query.history, signal);
    if (jsonHash(native) !== jsonHash(checkedNative)) throw precondition('原 BuildKit 原生图在物理盘点期间变化');
    const current = await registryServer(k8s, options, signal), checkedVolume = await buildKitStorage(k8s, options, current.pod, signal);
    if (current.pod.metadata.uid !== server.pod.metadata.uid || checkedVolume.containerId !== volume.containerId || checkedVolume.imageId !== volume.imageId) throw precondition('原 BuildKit 运行实例在盘点期间变化');
    for (const original of [server.namespace, server.service, server.pod, volume.config, volume.pvc, volume.pv, probe.pod]) {
      const actual = await k8s.get(Resources[original.kind]!, original.metadata.name, original.metadata.namespace, signal);
      if (!original.metadata.resourceVersion || !actual || actual.metadata.uid !== original.metadata.uid || actual.metadata.resourceVersion !== original.metadata.resourceVersion || actual.metadata.deletionTimestamp) throw precondition('原 BuildKit 安装或只读来源探针在盘点期间变化');
    }
    if ((await freshPlatformNode(k8s, server.pod))?.uid !== server.node.uid) throw precondition('原 BuildKit 节点在盘点期间变化');
    const origin = { namespaceUid: server.namespace.metadata.uid!, serviceUid: server.service.metadata.uid!, podUid: server.pod.metadata.uid!, containerId: volume.containerId, imageId: volume.imageId,
      configUid: volume.config.metadata.uid!, configIdentity: options.configIdentity, nodeUid: server.node.uid, nodeName: server.node.name, pvcUid: volume.pvc.metadata.uid!, pvUid: volume.pv.metadata.uid!,
      providerPath: volume.path, mountPath: options.mountPath, rootEpoch: inventory.rootIdentity, volumeEpoch: inventory.volumeIdentity, probeUid: probe.pod.metadata.uid!,
      workerId: native.worker.id, revision: native.info.revision, databases: inventory.databases.map(({ path, identity }) => ({ path, identity })) };
    return { identity: jsonHash(origin), origin, native, inventory, query };
  };
  return { capture, verify: async (query: BuildKitSourceQuery, original: { identity: string }, signal?: AbortSignal) => {
    const actual = await capture(query, signal);
    if (actual.identity !== original.identity) throw conflict('原 BuildKit 服务、缓存盘或数据库出生已替换', { code: 'native_buildkit_source_changed' });
    return actual;
  }, transport: async (original: { identity: string; query: BuildKitSourceQuery }) => {
    const actual = await capture(original.query); if (actual.identity !== original.identity) throw precondition('原 BuildKit 控制端口身份变化');
    const server = await registryServer(k8s, options, AbortSignal.timeout(15_000));
    if (server.pod.metadata.uid !== actual.origin.podUid) throw precondition('原 BuildKit 控制端口实例变化');
    return transport(address((server.pod['status'] as { podIP: string }).podIP, options.port));
  } };
}
