import type { CollectorTicket } from '../ports/metrics';
import type { MetricsDeps } from './observeMetrics';
import type { StorageResult, StorageTarget } from '../domain/observations';
import { boundedMap } from './observeMetrics';
import { localStorageTarget } from '../domain/storageUsage';
import type { MetricsOptions } from '../ports/metrics';

const sameTarget = (a: StorageTarget, b: StorageTarget | undefined) => !!b && a.uid === b.uid && a.volumeUid === b.volumeUid && a.node === b.node && a.relativePath === b.relativePath && a.address === b.address;
export async function observeStorage(deps: MetricsDeps, ticket: CollectorTicket, signal: AbortSignal, measure: (targets: StorageTarget[], options: MetricsOptions, signal: AbortSignal) => Promise<StorageResult[]>): Promise<boolean> {
  const observation = await deps.repository.latest(); if (!observation) return false;
  const topology = await deps.reader.topology(signal);
  const targets = observation.storageTargets.filter((t) => {
    const pvc = topology.pvcs.find((p) => p.metadata.uid === t.uid);
    return pvc && sameTarget(t, localStorageTarget(pvc, t.resourceId, topology, deps.options.probeRoot));
  });
  const nodes = [...new Set(targets.map((t) => t.node))];
  const batches = await boundedMap(nodes, 4, async (node) => {
    const group = targets.filter((t) => t.node === node), results: StorageResult[] = [];
    for (let i = 0; i < group.length; i += 64) { signal.throwIfAborted(); results.push(...await measure(group.slice(i, i + 64), deps.options, signal)); }
    return results;
  });
  const current = await deps.reader.topology(signal), currentInventory = await deps.inventory.latest();
  const valid = batches.flat().filter((r) => {
    const target = targets.find((t) => t.uid === r.uid), pvc = current.pvcs.find((p) => p.metadata.uid === r.uid);
    return target && pvc && currentInventory?.resources.some((resource) => resource.uid === r.uid) && sameTarget(target, localStorageTarget(pvc, target.resourceId, current, deps.options.probeRoot));
  });
  signal.throwIfAborted(); return deps.repository.saveStorage(valid, deps.clock.now().toISOString(), ticket);
}
