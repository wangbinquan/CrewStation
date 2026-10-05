import { basename } from 'node:path';
import { bindRegistryHistory, captureRegistryHistory, registryExclusiveConsumerFiles, registryHistoryIdentity, retainedRegistryQuery } from '@crewstation/filesystem-metrics';
import type { RegistryDeletionHistory } from '@crewstation/filesystem-metrics';
import type { K8sClient } from '@crewstation/k8s';
import { nativeRegistrySource } from './source';
import type { RegistryInventoryQuery } from './source';
import type { RegistrySourceOptions } from './origin';
import { nodeFileConsumerSource } from '../nodeFileConsumers';

/** Original K8s/PVC/native graph plus the whole node's descriptor/map users.
 * The owner adds its real persistent writer fence before issuing completion. */
export function nativeRegistryArtifacts(k8s: K8sClient, options: RegistrySourceOptions, fetcher: typeof fetch = fetch) {
  const original = { ...options }, source = nativeRegistrySource(k8s, original, fetcher);
  const consumers = nodeFileConsumerSource(k8s, { namespace: original.namespace, port: original.probePort, token: original.probeToken }, fetcher);
  return {
    capture: async (projectId: string, raw: RegistryInventoryQuery): Promise<RegistryDeletionHistory> => {
      const query = structuredClone(raw), current = await source.capture(query);
      const files = [...current.inventory.entries.filter(row => row.kind === 'file'), ...current.inventory.blobs.filter(row => !row.otherRepositories.length)]
        .map(row => ({ device: row.device, inode: row.inode }));
      const users = await consumers.capture({ uid: current.origin.nodeUid, name: current.origin.nodeName }, files);
      // Re-read the original source after the node observation; no replacement
      // probe or volume can be bound to an earlier graph by name alone.
      const checked = await source.verify(query, current);
      if (checked.inventory.revision !== current.inventory.revision) throw Error('Registry graph changed during the original consumer observation');
      return captureRegistryHistory({ version: 1, projectId, sourceIdentity: current.identity, origin: current.origin,
        query: { key: current.inventory.key, rootId: 'local', directory: basename(current.origin.providerPath), ...query },
        original: current.inventory, consumers: users.source });
    },
    inspect: async (raw: RegistryDeletionHistory) => {
      const history = captureRegistryHistory(raw), query = retainedRegistryQuery(history);
      const current = await source.verify(query, { identity: history.sourceIdentity });
      const remaining = bindRegistryHistory(history, current);
      const users = await consumers.observe(history.consumers, registryExclusiveConsumerFiles(history, current.inventory));
      const checked = await source.verify(query, { identity: history.sourceIdentity });
      if (checked.inventory.revision !== current.inventory.revision) throw Error('Registry graph changed while rechecking original file consumers');
      return { identity: registryHistoryIdentity(history), sourceIdentity: current.identity, ...remaining,
        consumerCount: users.count, consumerDigest: users.digest, inventory: checked.inventory,
        independent: true as const, physicalReclamationProven: false as const };
    },
  };
}
