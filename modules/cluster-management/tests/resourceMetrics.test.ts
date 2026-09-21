import { expect, test } from 'bun:test';
import { ClusterCapacitySchema, ClusterNodeSchema, ClusterUsageSchema, ClusterHistoryQuerySchema } from '@crewstation/contracts';
import { observeMetrics } from '../application/observeMetrics';
import { observeStorage } from '../application/observeStorage';
import { currentObservation, metricQueries, renderMetrics } from '../application/metricQueries';
import { historyExpressions, historyWindow } from '../domain/history';
import { localStorageTarget, storageProjection } from '../domain/storageUsage';
import { objectRecord } from '../domain/inventory';
import { metricsFixture, metricsTicket } from './metricsFixture';
import { admin, object } from './inventoryFixture';
const signal = () => new AbortController().signal;

test('two real collection cycles separate physical totals, managed resources, pending and completed requests', async () => {
  const f = metricsFixture(); await observeMetrics(f.deps, metricsTicket, signal());
  expect(f.observation().capacity.metrics.cpu?.state).toBe('warming-up'); f.advance(); await observeMetrics(f.deps, metricsTicket, signal());
  const o = f.observation(), c = ClusterCapacitySchema.parse(o.capacity); o.nodes.forEach((n) => ClusterNodeSchema.parse(n)); o.usages.forEach((u) => ClusterUsageSchema.parse(u));
  expect(c).toMatchObject({ nodes: 1, readyNodes: 1, podCount: 4, pendingPods: 1, capacity: { cpu: '10' }, demand: { requests: { cpu: '1.25' } }, pendingDemand: { requests: { cpu: '2' } } });
  expect(c.metrics.cpu?.value).toBe('1'); expect(c.metrics.networkRx?.value).toBe('10000'); expect(c.managed.demand.requests.cpu).toBe('0.25'); expect(c.managed.pvcs).toBe(1);
  expect(o.usages.some((u) => u.name === 'outside')).toBe(false); expect(o.nodes[0]?.devices['/dev/vda']?.diskRead?.value).toBe('1000');
  const app = o.usages.find((u) => u.name === 'app')!; expect(app.containers[0]).toMatchObject({ name: 'app', type: 'application', requests: { cpu: '250m' }, metrics: { cpu: { value: '1' }, ephemeralStorage: { value: '1024' } } });
  expect(o.nodes[0]?.managedPods).toContainEqual({ resourceId: app.resourceId, name: 'app', namespace: app.namespace }); expect(app.containers[0]?.metrics.cpuRequested?.value).toBe('0.25');
  expect(o.storageTargets).toHaveLength(1); expect(o.usages.find((u) => u.kind === 'PersistentVolumeClaim')?.metrics.volumeUsed?.state).toBe('warming-up');
  const exporter = renderMetrics(o, f.deps.clock.now().getTime()); expect(exporter).toContain('scope="node"'); expect(exporter).toContain('scope="container"'); expect(exporter).toContain('device="/dev/vda"'); expect(exporter).not.toContain('/local/work'); expect(exporter).not.toContain('namespace=');
  expect(renderMetrics(o, f.deps.clock.now().getTime() + 200_000).includes('cs_cluster_value{')).toBe(false);
});
test('bounded storage work verifies live UID before and after scanning, and keeps storage independent', async () => {
  const f = metricsFixture(); await observeMetrics(f.deps, metricsTicket, signal());
  await observeStorage(f.deps, metricsTicket, signal(), async (targets) => targets.map((t) => ({ uid: t.uid, volumeUid: t.volumeUid, metric: { unit: 'bytes', state: 'fresh', value: '2147483648', observedAt: f.deps.clock.now().toISOString(), source: 'local-path-probe' } })));
  f.advance(); await observeMetrics(f.deps, metricsTicket, signal());
  const pvc = f.observation().usages.find((u) => u.kind === 'PersistentVolumeClaim')!;
  expect(pvc.storage).toMatchObject({ requested: '1073741824', capacity: '1073741824', hardQuota: false, mounts: [{ name: 'app', node: 'node-a' }] }); expect(pvc.metrics.volumeUsed?.value).toBe('2147483648');
  await observeStorage(f.deps, metricsTicket, signal(), async (targets) => { f.pvc.metadata.uid = 'replacement'; return targets.map((t) => ({ uid: t.uid, volumeUid: t.volumeUid, metric: { unit: 'bytes', state: 'fresh', value: '10', source: 'probe' } })); });
  expect(f.storage()).toHaveLength(0);
  const g = metricsFixture(); expect(await observeStorage(g.deps, metricsTicket, signal(), async () => [])).toBe(false);
});
test('source failures, restarts and late observations retain honest states and do not claim complete capacity', async () => {
  const f = metricsFixture(); await observeMetrics(f.deps, metricsTicket, signal()); f.advance(); await observeMetrics(f.deps, metricsTicket, signal());
  f.deps.reader.sample = async () => ({ nodeUid: 'new-node', errors: [] }); f.advance(); await observeMetrics(f.deps, metricsTicket, signal());
  expect(f.observation().nodes[0]?.metrics.cpu?.state).toBe('error'); expect(f.observation().capacity.coverage.cpu?.complete).toBe(false);
  f.deps.reader.topology = async () => { throw new Error('403 forbidden'); }; f.advance(); await observeMetrics(f.deps, metricsTicket, signal()); expect(f.observation().capacity.errors.join()).toContain('403'); expect(f.observation().identitiesComplete).toBe(false);
  const aged = currentObservation(f.observation(), f.deps.clock.now().getTime() + 180_000); expect(aged.capacity.state).toBe('stale');
  const fresh = metricsFixture(); fresh.deps.inventory.latest = async () => undefined; await expect(observeMetrics(fresh.deps, metricsTicket, signal())).rejects.toMatchObject({ kind: 'unavailable' });
});
test('native PVC stats require the entire live Pod/PVC/PV chain, shared mounts do not multiply usage', () => {
  const f = metricsFixture(), resource = f.inventory.resources.find((r) => r.kind === 'PersistentVolumeClaim')!;
  const s = f.summary(), raw = s.pods[0]! as Record<string, unknown>; raw.volume = [{ name: 'work', pvcRef: { name: 'work', namespace: 'cs-demo' }, time: f.deps.clock.now().toISOString(), usedBytes: 1024 }];
  const projection = (summaries = [s, s]) => storageProjection(f.pvc, resource, f.topology, f.inventory.resources, summaries, [], f.deps.clock.now().getTime(), '/local');
  expect(projection().usage.metrics.volumeUsed?.value).toBe('1024'); expect(projection().target).toBeUndefined();
  objectRecord(objectRecord(f.volume.spec).claimRef).uid = 'wrong-uid'; expect(projection().usage.metrics.volumeUsed?.value).toBeUndefined(); expect(localStorageTarget(f.pvc, resource.resourceId, f.topology, '/local')).toBeUndefined();
});
test('volume target allowlist, node affinity and unsupported paths fail closed', () => {
  const f = metricsFixture(), id = f.inventory.resources[0]!.resourceId;
  expect(localStorageTarget(f.pvc, id, f.topology, '/other')).toBeUndefined();
  objectRecord(f.pvc.spec).volumeMode = 'Block'; expect(localStorageTarget(f.pvc, id, f.topology, '/local')).toBeUndefined(); delete objectRecord(f.pvc.spec).volumeMode;
  objectRecord(objectRecord(f.volume.spec).hostPath).path = '/local/../outside'; expect(localStorageTarget(f.pvc, id, f.topology, '/local')).toBeUndefined();
  objectRecord(objectRecord(f.volume.spec).hostPath).path = '/local/work'; f.topology.nodes.push({ ...f.node, metadata: { ...f.node.metadata, uid: 'duplicate' } }); expect(localStorageTarget(f.pvc, id, f.topology, '/local')).toBeUndefined();
  f.topology.nodes.pop(); f.topology.pods = f.topology.pods.filter((p) => p !== f.probe); expect(localStorageTarget(f.pvc, id, f.topology, '/local')?.address).toBeUndefined();
});
test('container types, host networking and extended resources remain explicit', async () => {
  const f = metricsFixture(), spec = objectRecord(f.pod.spec);
  spec.hostNetwork = true; spec.initContainers = [{ name: 'init', image: 'init', resources: { requests: { cpu: '1' } } }, { name: 'sidecar', restartPolicy: 'Always', image: 'sidecar', resources: { requests: { cpu: '500m' } } }]; spec.ephemeralContainers = [{ name: 'debug', image: 'debug' }];
  f.topology.pods.push({ ...object('Pod', 'unknown-node'), spec: { nodeName: 'missing' } }); await observeMetrics(f.deps, metricsTicket, signal());
  const p = f.observation().usages.find((u) => u.name === 'app')!; expect(p.containers.map((c) => c.type)).toEqual(['application', 'init', 'sidecar', 'ephemeral']); expect(p.metrics.networkRx?.state).toBe('unsupported'); expect(p.containers[1]?.metrics.cpu?.value).toBeUndefined();
  expect(f.observation().capacity.capacity['example.com/gpu']).toBe('2');
});
test('admin endpoints pin pagination, reject expired snapshots and summarize the full selected scope', async () => {
  const f = metricsFixture(); await observeMetrics(f.deps, metricsTicket, signal());
  const api = metricQueries(f.deps, async () => true, { range: async () => [] }), id = f.observation().nodes[0]!.resourceId;
  await expect(api.capacity({ ...admin, isAdmin: false })).rejects.toMatchObject({ kind: 'forbidden' });
  const page = await api.nodes(admin, { limit: 1, cursor: 0 }); expect(page.total).toBe(1); expect((await api.node(admin, id)).uid).toBe(f.node.metadata.uid!);
  await expect(api.node(admin, 'missing')).rejects.toMatchObject({ kind: 'not_found' }); await expect(api.nodes(admin, { limit: 1, cursor: 0, observationId: 'gone' })).rejects.toMatchObject({ details: { status: 410 } });
  const usage = await api.usage(admin, { resourceIds: [f.observation().usages[0]!.resourceId], scope: 'all' }); expect(usage.items).toHaveLength(1); expect(usage.summary.pvcs).toBe(1); expect(usage.summary.pods).toBe(2);
  expect((await api.historyResources(admin, { cursor: 0, limit: 1 })).nextCursor).toBe(1);
  f.advance(601_000); await expect(api.nodes(admin, { limit: 1, cursor: 0, observationId: page.observationId })).rejects.toMatchObject({ details: { status: 410 } });
});
test('seven day bucket bounds, custom tail and PromQL label escaping are deterministic', () => {
  const now = Date.parse('2026-09-21T12:00:00Z');
  const query = (seconds: number) => ClusterHistoryQuerySchema.parse({ scope: 'cluster', from: new Date(now - seconds * 1000).toISOString(), to: new Date(now).toISOString() });
  expect(historyWindow(query(86400), now).ends).toHaveLength(1440); expect(historyWindow(query(7 * 86400), now).ends).toHaveLength(1008); expect(historyWindow(query(3601), now).remainder).toBe(1);
  expect(() => historyWindow({ ...query(60), from: '2000-01-01T00:00:00Z' }, now)).toThrow('7 days');
  expect(ClusterHistoryQuerySchema.safeParse({ ...query(60), scope: 'container' }).success).toBe(false);
  expect(historyExpressions({ ...query(60), container: 'x"} or up' }, 'cpu', 60).average).toContain('container="x\\\"} or up"');
});

test('repeated topology outages cannot refresh request gauges or nested container and device observations', async () => {
  const f = metricsFixture(); await observeMetrics(f.deps, metricsTicket, signal()); f.advance(); await observeMetrics(f.deps, metricsTicket, signal());
  const at = f.observation().capacity.observedAt;
  f.deps.reader.topology = async () => { throw new Error('topology unavailable'); };
  f.advance(200_000); await observeMetrics(f.deps, metricsTicket, signal());
  const current = currentObservation(f.observation(), f.deps.clock.now().getTime());
  expect(current.capacity.observedAt).toBe(at); expect(current.capacity.system.metrics.cpuRequested?.state).toBe('stale');
  expect(current.usages.find((u) => u.kind === 'Pod')?.containers[0]?.metrics.cpu?.state).toBe('error');
  expect(renderMetrics(current, f.deps.clock.now().getTime())).not.toContain('cs_cluster_value{');
});
