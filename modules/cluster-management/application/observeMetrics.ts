import type { Clock } from '@crewstation/kernel';
import { newResourceId, PlatformError } from '@crewstation/kernel';
import type { ClusterHistoryResource, ClusterMetrics } from '@crewstation/contracts';
import type { CollectorTicket, MetricsOptions, MetricsReader, MetricsRepository, NodeSample } from '../ports/metrics';
import type { ClusterRepository } from '../ports/repository';
import type { MetricsObservation } from '../domain/observations';
import { objectArray, objectRecord } from '../domain/inventory';
import { capacityProjection, nodeProjection, podProjection } from '../domain/capacity';
import { diskStats } from '../domain/metricValues';
import { storageProjection } from '../domain/storageUsage';

export interface MetricsDeps { repository: MetricsRepository; inventory: ClusterRepository; reader: MetricsReader; clock: Clock; options: MetricsOptions }
const failedMetrics = (metrics: ClusterMetrics, reason: string): ClusterMetrics => Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, { ...value, state: 'error', reason, reasonCode: 'source-failed' }]));
export async function boundedMap<T, R>(items: T[], concurrency: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length); let offset = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => { while (offset < items.length) { const index = offset++; output[index] = await run(items[index]!); } }));
  return output;
}
function identitiesFor(observation: MetricsObservation): ClusterHistoryResource[] {
  const rows = [...observation.nodes.map((n) => ({ resourceId: n.resourceId, uid: n.uid, kind: 'Node', namespace: '', name: n.name, scope: 'cluster', projectId: undefined })), ...observation.usages];
  return rows.map((r) => ({ resourceId: r.resourceId, uid: r.uid, kind: r.kind, namespace: r.namespace, name: r.name, scope: r.scope, ...(r.projectId ? { projectId: r.projectId } : {}), firstSeen: observation.at, lastSeen: observation.at, deleted: false, versions: [{ from: observation.at, name: r.name, namespace: r.namespace, scope: r.scope, ...(r.projectId ? { projectId: r.projectId } : {}) }] }));
}
export async function observeMetrics(deps: MetricsDeps, ticket: CollectorTicket, signal: AbortSignal): Promise<boolean> {
  const [previous, inventory, measured] = await Promise.all([deps.repository.latest(), deps.inventory.latest(), deps.repository.storage()]);
  if (!inventory) throw new PlatformError('unavailable', 'Resource inventory has not been collected yet');
  const now = deps.clock.now().getTime(), id = newResourceId(), at = new Date(now).toISOString();
  let topology;
  try { topology = await deps.reader.topology(signal); }
  catch (error) {
    if (!previous || signal.aborted) throw error;
    const reason = `Cluster topology: ${String(error)}`;
    return deps.repository.save({ ...previous, id, at, identitiesComplete: false, identities: [], capacity: { ...previous.capacity, observationId: id, state: 'error', errors: [reason], metrics: failedMetrics(previous.capacity.metrics, reason) }, nodes: previous.nodes.map((n) => ({ ...n, errors: [reason], metrics: failedMetrics(n.metrics, reason), interfaces: Object.fromEntries(Object.entries(n.interfaces).map(([k, v]) => [k, failedMetrics(v, reason)])), devices: Object.fromEntries(Object.entries(n.devices).map(([k, v]) => [k, failedMetrics(v, reason)])) })), usages: previous.usages.map((u) => ({ ...u, metrics: failedMetrics(u.metrics, reason), containers: u.containers.map((c) => ({ ...c, metrics: failedMetrics(c.metrics, reason) })) })) }, ticket);
  }
  const ids = await deps.inventory.resourceIds(topology.nodes.map((n) => n.metadata.uid!));
  const samples = await boundedMap(topology.nodes, 4, async (node): Promise<NodeSample> => {
    try {
      const sample = await deps.reader.sample(node.metadata.name, signal);
      return sample.nodeUid === node.metadata.uid ? sample : { errors: ['Node UID changed during metrics collection'] };
    } catch (error) { return { errors: [String(error)] }; }
  });
  const counters: MetricsObservation['counters'] = {}, usages: MetricsObservation['usages'] = [], storageTargets: MetricsObservation['storageTargets'] = [];
  const nodes = topology.nodes.map((node, index) => {
    const sample = samples[index]!, rawNode = objectRecord(objectRecord(sample.summary).node);
    const ctx = { now, key: node.metadata.uid!, instance: `${node.metadata.uid}/${rawNode.startTime ?? ''}`, counters, previous: previous?.counters ?? {}, source: 'kubelet-summary' };
    const projected = nodeProjection(node, topology.pods, inventory.resources, ids.get(node.metadata.uid!)!, sample.summary, ctx);
    projected.errors.push(...sample.errors);
    if (sample.cadvisor) { try { projected.devices = diskStats(sample.cadvisor, { ...ctx, source: 'cadvisor-root-cgroup' }); } catch (error) { projected.errors.push(`Invalid cAdvisor metrics: ${String(error)}`); } }
    if (!sample.summary) { const old = previous?.nodes.find((n) => n.uid === projected.uid); if (old) projected.metrics = failedMetrics(old.metrics, sample.errors.join('; ')); }
    for (const pod of topology.pods.filter((p) => objectRecord(p.spec).nodeName === node.metadata.name)) {
      const resource = inventory.resources.find((r) => r.kind === 'Pod' && r.uid === pod.metadata.uid); if (!resource) continue;
      const stats = objectArray(objectRecord(sample.summary).pods).find((p) => objectRecord(p.podRef).uid === pod.metadata.uid);
      usages.push(podProjection(pod, resource, stats, { ...ctx, key: `${node.metadata.uid}/${resource.uid}`, instance: `${ctx.instance}/${resource.uid}/${stats?.startTime ?? ''}` }));
    }
    return projected;
  });
  for (const pod of topology.pods.filter((p) => !topology.nodes.some((n) => n.metadata.name === objectRecord(p.spec).nodeName))) {
    const resource = inventory.resources.find((r) => r.kind === 'Pod' && r.uid === pod.metadata.uid);
    if (resource) usages.push(podProjection(pod, resource, undefined, { now, key: resource.uid, instance: resource.uid, counters, previous: {}, source: 'kubelet-summary' }));
  }
  for (const pvc of topology.pvcs) {
    const resource = inventory.resources.find((r) => r.kind === 'PersistentVolumeClaim' && r.uid === pvc.metadata.uid); if (!resource) continue;
    const result = storageProjection(pvc, resource, topology, inventory.resources, samples.map((s) => s.summary), measured, now, deps.options.probeRoot);
    usages.push(result.usage); if (result.target) storageTargets.push(result.target);
  }
  const errors = nodes.flatMap((n) => n.errors.map((e) => `${n.name}: ${e}`));
  const observation: MetricsObservation = { id, at, inventorySnapshotId: inventory.id, nodes, usages, counters, storageTargets, identities: [], identitiesComplete: inventory.facts.complete && inventory.sources.every((s) => s.state === 'complete'), capacity: capacityProjection(id, inventory.id, nodes, topology.pods, usages, now, errors) };
  observation.identities = identitiesFor(observation); signal.throwIfAborted();
  return deps.repository.save(observation, ticket);
}
