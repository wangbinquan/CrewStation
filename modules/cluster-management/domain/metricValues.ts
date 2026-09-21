import type { ClusterCoverage, ClusterMetric, ClusterMetricName, ClusterMetrics } from '@crewstation/contracts';
import { metricUnits } from './observations';
import type { CounterSample } from './observations';
import { decimalValue, quantity } from './resourceDemand';
import { objectArray, objectRecord } from './inventory';

export const missingMetric = (name: ClusterMetricName, source: string, reason: string, state: ClusterMetric['state'] = 'unavailable'): ClusterMetric => ({ unit: metricUnits[name], state, source, reason, reasonCode: state });
export function freshness(metric: ClusterMetric, now: number, ttl = 45_000): ClusterMetric {
  if (!metric.observedAt || metric.state !== 'fresh') return metric;
  const age = now - Date.parse(metric.observedAt);
  if (!Number.isFinite(age) || age < -30_000) return { ...metric, state: 'error', reasonCode: 'clock-skew', reason: 'Source clock is outside the allowed window' };
  return age > ttl ? { ...metric, state: 'stale', reasonCode: 'expired', reason: 'Last successful sample has expired' } : metric;
}
export function gauge(name: ClusterMetricName, value: unknown, at: unknown, source: string, now: number): ClusterMetric {
  if ((typeof value !== 'string' && typeof value !== 'number') || typeof at !== 'string') return missingMetric(name, source, 'Source field or timestamp is missing');
  try { return freshness({ value: decimalValue(quantity(String(value))), unit: metricUnits[name], state: 'fresh', observedAt: at, source }, now, name === 'volumeUsed' ? 180_000 : 45_000); }
  catch { return missingMetric(name, source, 'Source value is invalid', 'error'); }
}
export function rate(name: ClusterMetricName, current: CounterSample | undefined, previous: CounterSample | undefined, source: string, now: number): ClusterMetric {
  if (!current) return missingMetric(name, source, 'Counter or timestamp is missing');
  const base: ClusterMetric = { ...missingMetric(name, source, 'Waiting for two samples from the same instance', 'warming-up'), observedAt: current.at };
  const age = freshness({ ...base, state: 'fresh' }, now);
  if (age.state !== 'fresh') return age;
  const elapsed = Date.parse(current.at) - Date.parse(previous?.at ?? '');
  if (!previous || previous.instance !== current.instance || !Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 60_000) return base;
  try {
    const delta = quantity(current.value) - quantity(previous.value);
    if (delta < 0n) return { ...base, reason: 'Counter reset; waiting for a new sample', reasonCode: 'counter-reset' };
    const divisor = name === 'cpu' ? 1_000_000_000n : 1n;
    return { ...base, state: 'fresh', reason: undefined, reasonCode: undefined, value: decimalValue(delta * 1000n / (BigInt(elapsed) * divisor)), windowStart: previous.at, windowEnd: current.at };
  } catch { return { ...base, state: 'error', reason: 'Invalid counter value' }; }
}
export function aggregateMetrics(rows: ClusterMetrics[], names: ClusterMetricName[], now: number, emptyObservedAt = now): { metrics: ClusterMetrics; coverage: Partial<Record<ClusterMetricName, ClusterCoverage>> } {
  const metrics: ClusterMetrics = {}, coverage: Partial<Record<ClusterMetricName, ClusterCoverage>> = {};
  for (const name of names) {
    const values = rows.map((r) => r[name]).filter((v): v is ClusterMetric => !!v).map((v) => freshness(v, now, name === 'volumeUsed' ? 180_000 : 45_000));
    const fresh = values.filter((v) => v.state === 'fresh' && v.value !== undefined);
    const dates = fresh.map((v) => v.observedAt!).sort(), coherent = !dates.length || Date.parse(dates.at(-1)!) - Date.parse(dates[0]!) <= (name === 'volumeUsed' ? 180_000 : 30_000);
    const valid = coherent ? fresh : [], complete = valid.length === rows.length;
    coverage[name] = { expected: rows.length, observed: values.filter((v) => v.value !== undefined).length, fresh: valid.length, missing: rows.length - valid.length, complete, ...(dates.length ? { oldestAt: dates[0], newestAt: dates.at(-1) } : {}), errors: [...new Set(values.filter((v) => v.state !== 'fresh').map((v) => v.reason ?? v.state)), ...(!coherent ? ['Source timestamps are too far apart'] : [])] };
    metrics[name] = valid.length || !rows.length ? { value: decimalValue(valid.reduce((sum, v) => sum + quantity(v.value!), 0n)), unit: metricUnits[name], state: 'fresh', observedAt: dates[0] ?? new Date(emptyObservedAt).toISOString(), source: 'aggregate', ...(complete ? {} : { reason: `Observed ${valid.length}/${rows.length}; partial total`, reasonCode: 'partial' }) } : missingMetric(name, 'aggregate', coverage[name]!.errors.join('; ') || 'No fresh samples', values.length === rows.length && values.every((v) => v.state === 'warming-up') ? 'warming-up' : 'unavailable');
  }
  return { metrics, coverage };
}
export interface SampleContext { now: number; key: string; instance: string; previous: Record<string, CounterSample>; counters: Record<string, CounterSample>; source: string }
export function sampleCounter(ctx: SampleContext, name: ClusterMetricName, value: unknown, at: unknown, suffix = '') {
  const key = `${ctx.key}/${name}/${suffix}`;
  let sample: CounterSample | undefined;
  if ((typeof value === 'number' || typeof value === 'string') && typeof at === 'string') {
    sample = { value: String(value), at, instance: ctx.instance };
    if (!ctx.previous[key] || Date.parse(at) > Date.parse(ctx.previous[key]!.at)) ctx.counters[key] = sample;
    else ctx.counters[key] = ctx.previous[key]!;
  }
  return rate(name, sample, ctx.previous[key], ctx.source, ctx.now);
}
export function computeStats(raw: unknown, ctx: SampleContext): ClusterMetrics {
  const s = objectRecord(raw), cpu = objectRecord(s.cpu), memory = objectRecord(s.memory), storage = objectRecord(s['ephemeral-storage']);
  const metrics: ClusterMetrics = { cpu: sampleCounter(ctx, 'cpu', cpu.usageCoreNanoSeconds, cpu.time), memory: gauge('memory', memory.workingSetBytes, memory.time, ctx.source, ctx.now), memoryUsage: gauge('memoryUsage', memory.usageBytes, memory.time, ctx.source, ctx.now), memoryAvailable: gauge('memoryAvailable', memory.availableBytes, memory.time, ctx.source, ctx.now) };
  if (s['ephemeral-storage']) metrics.ephemeralStorage = gauge('ephemeralStorage', storage.usedBytes, storage.time, ctx.source, ctx.now);
  return metrics;
}
export function networkStats(raw: unknown, ctx: SampleContext): { metrics: ClusterMetrics; interfaces: Record<string, ClusterMetrics> } {
  const network = objectRecord(raw), interfaces: Record<string, ClusterMetrics> = {};
  const all = new Map(objectArray(network.interfaces).map((n) => [String(n.name), n]));
  if (network.name) all.set(String(network.name), network);
  for (const [name, n] of all) interfaces[name] = { networkRx: sampleCounter(ctx, 'networkRx', n.rxBytes, network.time, name), networkTx: sampleCounter(ctx, 'networkTx', n.txBytes, network.time, name), networkRxErrors: sampleCounter(ctx, 'networkRxErrors', n.rxErrors, network.time, name), networkTxErrors: sampleCounter(ctx, 'networkTxErrors', n.txErrors, network.time, name) };
  return { metrics: interfaces[String(network.name)] ?? { networkRx: missingMetric('networkRx', ctx.source, 'No default network interface'), networkTx: missingMetric('networkTx', ctx.source, 'No default network interface') }, interfaces };
}
export function diskStats(text: string, ctx: SampleContext): Record<string, ClusterMetrics> {
  const devices: Record<string, ClusterMetrics> = {}, names: Record<string, ClusterMetricName> = { container_fs_reads_bytes_total: 'diskRead', container_fs_writes_bytes_total: 'diskWrite', container_fs_reads_total: 'diskReadOps', container_fs_writes_total: 'diskWriteOps' };
  for (const line of text.split('\n')) {
    const m = /^(container_fs_(?:reads|writes)(?:_bytes)?_total)\{([^}]*)\}\s+([\d.eE+-]+)(?:\s+\d+)?$/.exec(line);
    if (!m) continue;
    const labels = Object.fromEntries([...m[2]!.matchAll(/([a-zA-Z_][a-zA-Z_0-9]*)="((?:[^"\\]|\\.)*)"/g)].map((p) => [p[1]!, JSON.parse(`"${p[2]}"`) as string]));
    if (labels.id !== '/' || !labels.device || labels.device.length > 256 || !labels.device.startsWith('/dev/')) continue;
    const name = names[m[1]!]!, device = devices[labels.device] ??= {};
    device[name] = sampleCounter(ctx, name, m[3], new Date(ctx.now).toISOString(), labels.device);
  }
  // tmpfs mount paths have operation placeholders but no block-device byte counters.
  return Object.fromEntries(Object.entries(devices).filter(([, metrics]) => metrics.diskRead || metrics.diskWrite));
}
