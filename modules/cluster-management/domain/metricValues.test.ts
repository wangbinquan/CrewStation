import { expect, test } from 'bun:test';
import { aggregateMetrics, computeStats, diskStats, freshness, gauge, networkStats, rate, sampleCounter } from './metricValues';
import type { SampleContext } from './metricValues';
const now = Date.parse('2026-09-21T00:01:00Z'), at = new Date(now).toISOString(), before = new Date(now - 15_000).toISOString();
const sample = (value: string, time = at, instance = 'boot-a') => ({ value, at: time, instance });
const context = (): SampleContext => ({ now, key: 'node-a', instance: 'boot-a', previous: {}, counters: {}, source: 'kubelet-summary' });
test('rates preserve uint64 precision, real zero, windows, restart/reset/late gaps', () => {
  expect(rate('cpu', sample('9007199404740993'), sample('9007199254740993', before), 'summary', now).value).toBe('0.01');
  expect(rate('networkRx', sample('15000'), sample('0', before), 'summary', now).value).toBe('1000');
  expect(rate('networkRx', sample('0'), sample('0', before), 'summary', now).value).toBe('0');
  for (const [current, previous] of [[sample('1'), undefined], [sample('1'), sample('2', before)], [sample('1'), sample('0')], [sample('1'), sample('0', before, 'other')], [sample('1'), sample('0', new Date(now - 70_000).toISOString())]]) expect(rate('cpu', current, previous, 's', now).state).toBe('warming-up');
  expect(rate('cpu', undefined, undefined, 's', now).state).toBe('unavailable');
  expect(rate('cpu', sample('bad'), sample('0', before), 's', now).state).toBe('error');
  expect(rate('cpu', sample('1', '2020-01-01'), undefined, 's', now).state).toBe('stale');
});
test('gauge freshness and source coverage never turn missing into zero', () => {
  const live = gauge('memory', 0, at, 's', now), stale = gauge('memory', 100, before, 's', now + 50_000);
  expect(live.value).toBe('0'); expect(stale.state).toBe('stale');
  expect(gauge('memory', -1, at, 's', now).state).toBe('error'); expect(gauge('memory', null, at, 's', now).value).toBeUndefined();
  expect(gauge('memory', 1, 'not-a-date', 's', now).state).toBe('error'); expect(gauge('memory', 1, at, 's', now - 31_000).state).toBe('error');
  expect(freshness({ ...live, observedAt: undefined }, now)).toEqual({ ...live, observedAt: undefined });
  const result = aggregateMetrics([{ memory: live }, { memory: stale }, {}], ['memory'], now);
  expect(result.metrics.memory?.value).toBe('0'); expect(result.coverage.memory).toMatchObject({ expected: 3, fresh: 1, missing: 2, complete: false });
  expect(aggregateMetrics([{}], ['cpu'], now).metrics.cpu?.value).toBeUndefined();
  expect(aggregateMetrics([], ['cpu'], now).metrics.cpu?.value).toBe('0');
  const old = gauge('memory', 2, new Date(now - 40_000).toISOString(), 's', now);
  expect(aggregateMetrics([{ memory: live }, { memory: old }], ['memory'], now).metrics.memory?.value).toBeUndefined();
});
test('network default is deduplicated and samples cannot regress', () => {
  const ctx = context(); ctx.previous['node-a/networkRx/eth0'] = sample('100', before);
  const network = networkStats({ time: at, name: 'eth0', rxBytes: 1600, txBytes: 20, interfaces: [{ name: 'eth0', rxBytes: 999999 }, { name: 'cni0', rxBytes: 3 }] }, ctx);
  expect(Object.keys(network.interfaces)).toHaveLength(2); expect(network.metrics.networkRx?.value).toBe('100');
  expect(networkStats({}, ctx).metrics.networkRx?.state).toBe('unavailable');
  ctx.previous['node-a/cpu/'] = sample('2', at); sampleCounter(ctx, 'cpu', '1', before); expect(ctx.counters['node-a/cpu/']).toEqual(ctx.previous['node-a/cpu/']);
  expect(computeStats({ cpu: { time: at, usageCoreNanoSeconds: 1 }, memory: { time: at, workingSetBytes: 1024, usageBytes: 2048 }, 'ephemeral-storage': { time: at, usedBytes: 100 } }, context()).ephemeralStorage?.value).toBe('100');
});

test('root cgroup filesystem mounts are not exported as physical disk devices', () => {
  // Kubelet emits zero operation counters for overlay and per-Pod tmpfs mounts.
  const text = ['container_fs_reads_bytes_total{device="/dev/vda",id="/"} 2048', 'container_fs_reads_total{device="/dev/vda",id="/"} 4', 'container_fs_reads_total{device="overlay",id="/"} 0', 'container_fs_reads_total{device="/run/containerd/sandboxes/uid/shm",id="/"} 0', 'container_fs_reads_bytes_total{device="/dev/vda",id="/pod/1"} 999999'].join('\n');
  expect(Object.keys(diskStats(text, context()))).toEqual(['/dev/vda']);
});
