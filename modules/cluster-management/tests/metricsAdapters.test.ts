import { expect, test } from 'bun:test';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { kubernetesMetricsReader } from '../adapters/k8s/metricsReader';
import { measureStorageTargets } from '../adapters/http/storageProbe';
import { prometheusHistoryReader } from '../adapters/http/prometheus';
import { queryHistory, historyResources } from '../application/historyQueries';
import { observeMetrics } from '../application/observeMetrics';
import { ClusterHistoryQuerySchema } from '@crewstation/contracts';
import { metricsFixture, metricsTicket } from './metricsFixture';
import { object } from './inventoryFixture';
const signal = () => new AbortController().signal;
test('Kubernetes reader pages full topology, preserves counters and isolates endpoint failures', async () => {
  const k8s = createFakeK8sClient(), node = await k8s.create(object('Node', 'node', ''));
  await k8s.create(object('Pod', 'pod')); await k8s.create(object('PersistentVolume', 'pv', '')); await k8s.create(object('PersistentVolumeClaim', 'pvc'));
  const list = k8s.listPage; let expired = false;
  k8s.listPage = async (...args) => { if (!expired) { expired = true; throw new Error('410 expired'); } return list(...args); };
  k8s.nodeMetrics = async (_, endpoint) => endpoint === 'summary' ? '{"counter":9007199254740993}' : 'metrics';
  const reader = kubernetesMetricsReader(k8s); expect((await reader.topology(signal())).pods).toHaveLength(1); expect(await reader.sample('node', signal())).toMatchObject({ nodeUid: node.metadata.uid, summary: { counter: '9007199254740993' }, cadvisor: 'metrics' });
  k8s.nodeMetrics = async () => { throw new Error('403 denied'); }; expect((await reader.sample('node', signal())).errors).toHaveLength(2);
  k8s.listPage = async () => { throw new Error('500 failed'); }; await expect(reader.topology(signal())).rejects.toThrow('500');
  expect(Resources.PersistentVolume?.namespaced).toBe(false); expect(Resources.Node?.namespaced).toBe(false);
});
test('probe adapter keeps opaque UID association and reports HTTP, invalid and omitted target failures', async () => {
  const f = metricsFixture(); await observeMetrics(f.deps, metricsTicket, signal()); const targets = f.observation().storageTargets;
  let sent = ''; const fetcher = (async (url: string, options: RequestInit) => { sent = String(url) + String(options.body); return Response.json({ items: targets.map((t) => ({ key: `${t.uid}/${t.volumeUid}`, state: 'fresh', allocatedBytes: '4096', durationMs: 1, observedAt: new Date().toISOString() })) }); }) as unknown as typeof fetch;
  expect((await measureStorageTargets(targets, f.deps.options, signal(), fetcher))[0]?.metric.value).toBe('4096'); expect(sent).toContain('10.0.0.20:8095'); expect(sent).not.toContain('CS_STORAGE_PROBE_TOKEN');
  for (const response of [new Response('', { status: 403 }), new Response('not json'), new Response('x'.repeat(128001)), Response.json({ items: [] })]) expect((await measureStorageTargets(targets, f.deps.options, signal(), (async () => response) as unknown as typeof fetch))[0]?.metric.state).toBe('error');
  expect(await measureStorageTargets([], f.deps.options, signal(), fetcher)).toEqual([]); expect((await measureStorageTargets([{ ...targets[0]!, address: 'outside.example' }], f.deps.options, signal(), fetcher))[0]?.metric.state).toBe('error');
});
test('Prometheus adapter bounds matrix/points and authenticates without putting credentials in URLs', async () => {
  let target = '', authorization = '';
  const reader = prometheusHistoryReader('http://prometheus:9090', 'query-secret', (async (url: URL, init: RequestInit) => { target = String(url); authorization = new Headers(init.headers).get('authorization')!; return Response.json({ status: 'success', data: { resultType: 'matrix', result: [{ metric: { scope: 'cluster' }, values: [[100, '2']] }] } }); }) as unknown as typeof fetch);
  expect(await reader.range('test{}', 100, 100, 15, signal())).toHaveLength(1); expect(authorization).toStartWith('Basic '); expect(target).not.toContain('query-secret'); expect(new URL(target).searchParams.get('query')).toBe('test{}');
  for (const body of [{ status: 'error' }, { status: 'success', data: { resultType: 'matrix', result: new Array(9).fill({}) } }, { status: 'success', data: { resultType: 'matrix', result: [{ values: [[100, 'NaN']] }] } }, { status: 'success', data: { resultType: 'matrix', result: [{ values: [[101, '2']] }] } }]) await expect(prometheusHistoryReader('http://prometheus', '', (async () => Response.json(body)) as unknown as typeof fetch).range('x', 100, 100, 15, signal())).rejects.toThrow();
  await expect(prometheusHistoryReader('', '').range('x', 100, 100, 15, signal())).rejects.toThrow('configured');
  await expect(prometheusHistoryReader('http://prometheus', '', (async () => new Response('', { status: 503 })) as unknown as typeof fetch).range('x', 100, 100, 15, signal())).rejects.toThrow('503');
});
test('history returns averages/peaks, explicit gaps, custom tails and stable deleted identities', async () => {
  const f = metricsFixture(); await observeMetrics(f.deps, metricsTicket, signal()); const now = f.deps.clock.now().getTime(), query = ClusterHistoryQuerySchema.parse({ scope: 'cluster', from: new Date(now - 61_000).toISOString(), to: new Date(now).toISOString(), metrics: 'cpu' });
  const reader = { range: async (expression: string, start: number, end: number, step: number) => {
    const values: [number, string][] = []; for (let at = start; at <= end; at += step) if (at !== start + step) values.push([at, expression.startsWith('min_over') ? String(now / 1000 - 3600) : expression.includes('coverage') ? '1' : expression.startsWith('max_over') ? '2' : '1']);
    return [{ metric: { scope: 'cluster', metric: 'cpu' }, values }];
  } };
  const result = await queryHistory(f.deps, reader, query); expect(result.state).toBe('fresh'); expect(result.series[0]?.points).toHaveLength(5); expect(result.series[0]?.points[1]).toMatchObject({ average: null, peak: null, coverage: 0, complete: false }); expect(result.series[0]?.points.at(-1)).toMatchObject({ average: 1, peak: 2, complete: true }); expect(result.availableFrom).toBeDefined();
  expect((await queryHistory(f.deps, { range: async () => { throw new Error('history offline'); } }, query)).reason).toBe('history offline');
  expect((await queryHistory(f.deps, { range: async () => [{ metric: { scope: 'pod', metric: 'cpu' }, values: [] }] }, query)).state).toBe('error');
  await expect(queryHistory(f.deps, reader, { ...query, scope: 'pod', resourceId: crypto.randomUUID() })).rejects.toMatchObject({ kind: 'not_found' });
  await expect(queryHistory(f.deps, reader, { ...query, from: '2000-01-01T00:00:00Z' })).rejects.toMatchObject({ kind: 'validation' });
  const identities = await f.deps.repository.identities(); identities[0]!.deleted = true;
  expect((await historyResources(f.deps, { cursor: 0, limit: 1, q: identities[0]!.name })).items[0]?.deleted).toBe(true);
});
