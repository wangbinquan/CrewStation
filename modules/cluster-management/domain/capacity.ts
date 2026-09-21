import type { ClusterCapacity, ClusterMetricName, ClusterMetrics, ClusterDemand, ClusterNode, ClusterResource, ClusterUsage, ClusterUsageSummary } from '@crewstation/contracts';
import type { ResourceObject } from './inventory';
import { objectArray, objectRecord, stringRecord } from './inventory';
import { activePod, addDemand, combine, emptyDemand, normalized, podDemand } from './resourceDemand';
import { aggregateMetrics, computeStats, gauge, missingMetric, networkStats } from './metricValues';
import type { SampleContext } from './metricValues';

export const nodeMetricNames: ClusterMetricName[] = ['cpu', 'memory', 'memoryUsage', 'memoryAvailable', 'fsCapacity', 'fsUsed', 'fsAvailable', 'fsInodes', 'fsInodesUsed', 'networkRx', 'networkTx', 'networkRxErrors', 'networkTxErrors', 'cpuRequested', 'memoryRequested', 'ephemeralRequested', 'cpuCapacity', 'memoryCapacity', 'ephemeralCapacity', 'cpuAllocatable', 'memoryAllocatable', 'ephemeralAllocatable'];
const usageMetricNames: ClusterMetricName[] = ['cpu', 'memory', 'ephemeralStorage', 'networkRx', 'networkTx'];
export function budgetMetrics(demand: ClusterDemand, capacity: Record<string, string>, allocatable: Record<string, string>, now: number): ClusterMetrics {
  const result: ClusterMetrics = {}, at = new Date(now).toISOString();
  for (const [key, requested, cap, available] of [['cpu', 'cpuRequested', 'cpuCapacity', 'cpuAllocatable'], ['memory', 'memoryRequested', 'memoryCapacity', 'memoryAllocatable'], ['ephemeral-storage', 'ephemeralRequested', 'ephemeralCapacity', 'ephemeralAllocatable']] as const) {
    result[requested] = gauge(requested, demand.requests[key] ?? '0', at, 'kubernetes-resource-spec', now);
    if (capacity[key] !== undefined) result[cap] = gauge(cap, capacity[key], at, 'kubernetes-node-status', now);
    if (allocatable[key] !== undefined) result[available] = gauge(available, allocatable[key], at, 'kubernetes-node-status', now);
  }
  return result;
}
export function nodeProjection(node: ResourceObject, pods: ResourceObject[], managed: ClusterResource[], id: string, summary: unknown, ctx: SampleContext): ClusterNode {
  const status = objectRecord(node.status), spec = objectRecord(node.spec), stats = objectRecord(objectRecord(summary).node), errors: string[] = [];
  const scheduled = pods.filter((p) => activePod(p) && objectRecord(p.spec).nodeName === node.metadata.name), network = networkStats(stats.network, ctx);
  const fs = objectRecord(stats.fs), runtime = objectRecord(stats.runtime), imageFs = objectRecord(runtime.imageFs), containerFs = objectRecord(runtime.containerFs);
  const conditions = objectArray(status.conditions).map((c) => ({ type: String(c.type), status: String(c.status), reason: String(c.message ?? c.reason ?? '') }));
  const demand = scheduled.reduce((s, p) => addDemand(s, podDemand(p)), emptyDemand());
  const metrics = { ...computeStats(stats, ctx), ...network.metrics, ...budgetMetrics(demand, normalized(status.capacity, errors), normalized(status.allocatable, errors), ctx.now) };
  for (const [metric, field] of [['fsCapacity', 'capacityBytes'], ['fsUsed', 'usedBytes'], ['fsAvailable', 'availableBytes'], ['fsInodes', 'inodes'], ['fsInodesUsed', 'inodesUsed']] as const) metrics[metric] = gauge(metric, fs[field], fs.time, ctx.source, ctx.now);
  metrics.imageFsUsed = gauge('imageFsUsed', imageFs.usedBytes, imageFs.time, ctx.source, ctx.now);
  metrics.containerFsUsed = gauge('containerFsUsed', containerFs.usedBytes, containerFs.time, ctx.source, ctx.now);
  return { resourceId: id, uid: node.metadata.uid!, name: node.metadata.name, roles: Object.keys(node.metadata.labels ?? {}).filter((k) => k.startsWith('node-role.kubernetes.io/')).map((k) => k.slice('node-role.kubernetes.io/'.length)), version: String(objectRecord(status.nodeInfo).kubeletVersion ?? ''), ready: conditions.some((c) => c.type === 'Ready' && c.status === 'True'), unschedulable: spec.unschedulable === true, conditions, capacity: normalized(status.capacity, errors), allocatable: normalized(status.allocatable, errors), demand, podCount: scheduled.length, metrics, interfaces: network.interfaces, devices: {}, managedPodIds: managed.filter((r) => scheduled.some((p) => p.metadata.uid === r.uid)).map((r) => r.resourceId), managedPods: managed.filter((r) => scheduled.some((p) => p.metadata.uid === r.uid)).map((r) => ({ resourceId: r.resourceId, name: r.name, namespace: r.namespace })), errors };
}
export function podProjection(pod: ResourceObject, resource: ClusterResource, summary: unknown, ctx: SampleContext): ClusterUsage {
  const spec = objectRecord(pod.spec), status = objectRecord(pod.status), raw = objectRecord(summary), hostNetwork = spec.hostNetwork === true;
  const containerGroup = (field: string, statusField: string, type: 'application' | 'init' | 'ephemeral') => objectArray(spec[field]).map((c) => {
    const live = objectArray(status[statusField]).find((s) => s.name === c.name) ?? {}, state = objectRecord(live.state), sample = objectArray(raw.containers).find((s) => s.name === c.name);
    const start = String(objectRecord(state.running).startedAt ?? objectRecord(state.terminated).startedAt ?? ''), child = { ...ctx, key: `${ctx.key}/container/${c.name}`, instance: `${ctx.instance}/${c.name}/${sample?.startTime ?? start}/${live.containerID ?? ''}` };
    const metrics = { ...computeStats(sample, child), ...budgetMetrics({ ...emptyDemand(), requests: normalized(objectRecord(c.resources).requests, []) }, {}, {}, ctx.now) }, rootfs = objectRecord(sample?.rootfs), logs = objectRecord(sample?.logs);
    const storage = aggregateMetrics([{ ephemeralStorage: gauge('ephemeralStorage', rootfs.usedBytes, rootfs.time, ctx.source, ctx.now) }, { ephemeralStorage: gauge('ephemeralStorage', logs.usedBytes, logs.time, ctx.source, ctx.now) }], ['ephemeralStorage'], ctx.now);
    metrics.ephemeralStorage = storage.coverage.ephemeralStorage?.complete ? storage.metrics.ephemeralStorage : missingMetric('ephemeralStorage', ctx.source, 'Container rootfs or logs statistics missing');
    return { name: String(c.name), type: type === 'init' && c.restartPolicy === 'Always' ? 'sidecar' as const : type, image: String(c.image ?? ''), state: Object.keys(state)[0] ?? 'unknown', ...(start ? { startedAt: start } : {}), requests: stringRecord(objectRecord(c.resources).requests), limits: stringRecord(objectRecord(c.resources).limits), metrics };
  });
  const network = hostNetwork ? { networkRx: missingMetric('networkRx', ctx.source, 'hostNetwork shares the node network', 'unsupported'), networkTx: missingMetric('networkTx', ctx.source, 'hostNetwork shares the node network', 'unsupported') } : networkStats(raw.network, ctx).metrics;
  return { resourceId: resource.resourceId, uid: resource.uid, kind: 'Pod', namespace: resource.namespace, name: resource.name, scope: resource.ownership.scope, ...(resource.ownership.scope === 'project' ? { projectId: resource.ownership.projectId } : {}), node: String(spec.nodeName ?? ''), phase: String(status.phase ?? 'Unknown'), demand: podDemand(pod), metrics: { ...computeStats(raw, ctx), ...network, ...budgetMetrics(podDemand(pod), {}, {}, ctx.now) }, containers: [...containerGroup('containers', 'containerStatuses', 'application'), ...containerGroup('initContainers', 'initContainerStatuses', 'init'), ...containerGroup('ephemeralContainers', 'ephemeralContainerStatuses', 'ephemeral')], qos: String(status.qosClass ?? ''), hostNetwork, podRequests: stringRecord(objectRecord(spec.resources).requests), podLimits: stringRecord(objectRecord(spec.resources).limits) };
}
export function usageSummary(usages: ClusterUsage[], now: number, observedAt = now): ClusterUsageSummary {
  const pods = usages.filter((u) => u.kind === 'Pod' && !['Succeeded', 'Failed'].includes(u.phase)), pvcs = usages.filter((u) => u.kind === 'PersistentVolumeClaim');
  const demand = pods.filter((p) => p.node).reduce((s, p) => addDemand(s, p.demand), emptyDemand()), pendingDemand = pods.filter((p) => !p.node).reduce((s, p) => addDemand(s, p.demand), emptyDemand());
  const aggregate = aggregateMetrics(pods.map((p) => p.metrics), usageMetricNames.filter((n) => !n.startsWith('network')), now, observedAt);
  const network = aggregateMetrics(pods.filter((p) => !p.hostNetwork).map((p) => p.metrics), ['networkRx', 'networkTx'], now, observedAt), volumes = aggregateMetrics(pvcs.map((p) => p.metrics), ['volumeUsed'], now, observedAt);
  const storage = pvcs.reduce<Record<string, string>>((s, p) => combine(s, { requested: p.storage?.requested ?? '0', capacity: p.storage?.capacity ?? '0' }), { requested: '0', capacity: '0' });
  return { pods: pods.length, pvcs: pvcs.length, demand, pendingDemand, storageRequested: storage.requested!, storageCapacity: storage.capacity!, metrics: { ...aggregate.metrics, ...network.metrics, ...volumes.metrics, ...budgetMetrics(demand, {}, {}, observedAt), storageRequested: gauge('storageRequested', storage.requested, new Date(observedAt).toISOString(), 'kubernetes-pvc', now), storageCapacity: gauge('storageCapacity', storage.capacity, new Date(observedAt).toISOString(), 'kubernetes-pvc', now) }, coverage: { ...aggregate.coverage, ...network.coverage, ...volumes.coverage } };
}
export function capacityProjection(id: string, inventoryId: string, nodes: ClusterNode[], pods: ResourceObject[], usages: ClusterUsage[], now: number, errors: string[]): ClusterCapacity {
  const active = pods.filter(activePod), pending = active.filter((p) => !objectRecord(p.spec).nodeName), aggregate = aggregateMetrics(nodes.map((n) => n.metrics), nodeMetricNames, now);
  return { observationId: id, inventorySnapshotId: inventoryId, observedAt: new Date(now).toISOString(), scope: 'cluster', state: errors.length ? 'error' : 'fresh', errors, nodes: nodes.length, readyNodes: nodes.filter((n) => n.ready).length, schedulableNodes: nodes.filter((n) => n.ready && !n.unschedulable).length, podCount: active.length, pendingPods: pending.length, capacity: nodes.reduce((s, n) => combine(s, n.capacity), {}), allocatable: nodes.reduce((s, n) => combine(s, n.allocatable), {}), demand: active.filter((p) => objectRecord(p.spec).nodeName).reduce((s, p) => addDemand(s, podDemand(p)), emptyDemand()), pendingDemand: pending.reduce((s, p) => addDemand(s, podDemand(p)), emptyDemand()), ...aggregate, managed: usageSummary(usages, now), system: usageSummary(usages.filter((u) => u.scope === 'system'), now), projects: Object.fromEntries([...new Set(usages.map((u) => u.projectId).filter((p): p is string => !!p))].map((p) => [p, usageSummary(usages.filter((u) => u.projectId === p), now)])) };
}
