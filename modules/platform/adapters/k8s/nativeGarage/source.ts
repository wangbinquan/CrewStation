import { isIP } from 'node:net';
import { basename, isAbsolute } from 'node:path';
import { createGarageInventoryClient } from '@crewstation/filesystem-metrics';
import type { GarageInventoryRequest } from '@crewstation/filesystem-metrics';
import { Resources } from '@crewstation/k8s';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { jsonHash, conflict } from '@crewstation/kernel';
import { freshPlatformNode } from '../platformPodTermination';
import { registryProbe, registryServer } from '../nativeRegistry/origin';
import { garageStorage, garageUnavailable } from './origin';
import type { GarageSourceOptions } from './origin';

export type GarageInventoryQuery = GarageInventoryRequest['query'];
/** A node/PVC-bound native observation. The common service/probe selectors are
 * read-only; Garage's mounted configuration and layout are checked separately. */
export function nativeGarageSource(k8s: K8sClient, raw: GarageSourceOptions, fetcher: typeof fetch = fetch) {
  const options = { ...raw };
  if (options.probeToken.length < 32 || !isAbsolute(options.probeRoot) || !/^sha256:[a-f0-9]{64}$/.test(options.imageDigest)
    || ![options.port, options.probePort].every(value => Number.isInteger(value) && value > 0 && value <= 65535)) throw garageUnavailable('Garage 原来源配置不完整');
  const capture = async (rawQuery: GarageInventoryQuery, callerSignal?: AbortSignal) => {
    const query = structuredClone(rawQuery), signal = AbortSignal.any([...(callerSignal ? [callerSignal] : []), AbortSignal.timeout(45_000)]);
    const server = await registryServer(k8s, options, signal), storage = await garageStorage(k8s, options, server.pod, signal);
    const probe = await registryProbe(k8s, options, server.node.name, signal);
    const client = createGarageInventoryClient({ baseUrl: `http://${isIP(probe.address) === 6 ? '[' + probe.address + ']' : probe.address}:${options.probePort}`,
      token: options.probeToken, fetch: (url, init) => fetcher(url, init) });
    const started = Date.now(), key = jsonHash({ service: server.service.metadata.uid, metadata: storage.metadata.pvc.metadata.uid, data: storage.data.pvc.metadata.uid, query });
    const inventory = await client.observe({ key, rootId: 'local', metadataDirectory: basename(storage.metadata.path), dataDirectory: basename(storage.data.path), query }, signal);
    for (const observedAt of [inventory.metadata.observedAt, inventory.blocks.observedAt]) if (Date.parse(observedAt) < started - 5000 || Date.parse(observedAt) > Date.now() + 5000) throw garageUnavailable('Garage 原盘点时间不符');
    const current = await registryServer(k8s, options, signal), currentStorage = await garageStorage(k8s, options, current.pod, signal);
    if (current.pod.metadata.uid !== server.pod.metadata.uid || currentStorage.containerId !== storage.containerId || currentStorage.imageId !== storage.imageId) throw garageUnavailable('Garage 原运行实例在盘点期间变化');
    const pinned: K8sObject[] = [server.namespace, server.service, server.pod, storage.config, storage.credentials, storage.metadata.pvc, storage.metadata.pv, storage.data.pvc, storage.data.pv, probe.pod];
    for (const original of pinned) {
      const actual = await k8s.get(Resources[original.kind]!, original.metadata.name, original.metadata.namespace, signal);
      if (!original.metadata.resourceVersion || !actual || actual.metadata.uid !== original.metadata.uid || actual.metadata.resourceVersion !== original.metadata.resourceVersion || actual.metadata.deletionTimestamp) throw garageUnavailable('Garage 原挂载或来源探针在盘点期间变化');
    }
    if ((await freshPlatformNode(k8s, server.pod))?.uid !== server.node.uid) throw garageUnavailable('Garage 原节点在盘点期间变化');
    const origin = { namespaceUid: server.namespace.metadata.uid!, serviceUid: server.service.metadata.uid!, podUid: server.pod.metadata.uid!,
      containerId: storage.containerId, imageId: storage.imageId, nodeUid: server.node.uid, nodeName: server.node.name, configIdentity: storage.configIdentity,
      metadata: { pvcUid: storage.metadata.pvc.metadata.uid!, pvUid: storage.metadata.pv.metadata.uid!, providerPath: storage.metadata.path, mountPath: storage.metadata.mountPath,
        rootEpoch: inventory.metadata.source.rootIdentity, volumeEpoch: inventory.metadata.source.volumeIdentity, databaseEpoch: inventory.metadata.source.databaseIdentity },
      data: { pvcUid: storage.data.pvc.metadata.uid!, pvUid: storage.data.pv.metadata.uid!, providerPath: storage.data.path, mountPath: storage.data.mountPath,
        rootEpoch: inventory.blocks.rootIdentity, volumeEpoch: inventory.blocks.volumeIdentity }, probeUid: probe.pod.metadata.uid! };
    return { identity: jsonHash(origin), origin, inventory };
  };
  return { capture, verify: async (query: GarageInventoryQuery, original: { identity: string }, signal?: AbortSignal) => {
    const current = await capture(query, signal); if (current.identity !== original.identity) throw conflict('Garage 原实例或存储来源已替换', { code: 'native_garage_source_changed' }); return current;
  } };
}
