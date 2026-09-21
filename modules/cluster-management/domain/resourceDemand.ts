import type { ClusterDemand } from '@crewstation/contracts';
import { objectArray, objectRecord, stringRecord } from './inventory';
import type { ResourceObject } from './inventory';

const SCALE = 1_000_000_000n;
const decimal: Record<string, number> = { n: -9, u: -6, m: -3, '': 0, k: 3, K: 3, M: 6, G: 9, T: 12, P: 15, E: 18 };
/** Exact nano base units. No JS floating point arithmetic enters capacity accounting. */
export function quantity(raw: string): bigint {
  const m = /^\+?(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+|[numkKMGTPE]|[KMGTPE]i)?$/.exec(raw);
  if (!m || raw.length > 100) throw new Error(`Invalid Kubernetes quantity: ${raw}`);
  const [whole = '', fraction = ''] = m[1]!.split('.'), suffix = m[2] ?? '';
  let n = BigInt((whole || '0') + fraction), power = 9 - fraction.length;
  if (suffix.endsWith('i')) n *= 1024n ** BigInt('KMGTPE'.indexOf(suffix[0]!) + 1);
  else power += suffix.length > 1 && /^[eE]/.test(suffix) ? Number(suffix.slice(1)) : decimal[suffix]!;
  if (!Number.isInteger(power) || Math.abs(power) > 100) throw new Error(`Quantity exponent out of range: ${raw}`);
  if (power >= 0) return n * 10n ** BigInt(power);
  const divisor = 10n ** BigInt(-power);
  return (n + divisor - 1n) / divisor;
}
export function decimalValue(value: bigint): string {
  const sign = value < 0 ? '-' : '', n = value < 0 ? -value : value;
  const fraction = String(n % SCALE).padStart(9, '0').replace(/0+$/, '');
  return `${sign}${n / SCALE}${fraction ? `.${fraction}` : ''}`;
}
export function normalized(values: unknown, errors: string[] = []): Record<string, string> {
  return Object.fromEntries(Object.entries(stringRecord(values)).flatMap(([key, raw]) => {
    try { return [[key, decimalValue(quantity(raw))]]; } catch (e) { errors.push(`${key}: ${String(e)}`); return []; }
  }));
}
export function combine(a: Record<string, string>, b: Record<string, string>, mode: 'sum' | 'max' = 'sum'): Record<string, string> {
  const result = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const x = quantity(result[key] ?? '0'), y = quantity(value);
    result[key] = decimalValue(mode === 'sum' ? x + y : x > y ? x : y);
  }
  return result;
}
export const emptyDemand = (): ClusterDemand => ({ requests: {}, limits: {}, missingRequests: {}, unboundedLimits: {}, errors: [] });
export function addDemand(a: ClusterDemand, b: ClusterDemand): ClusterDemand {
  const counts = (x: Record<string, number>, y: Record<string, number>) => Object.fromEntries([...new Set([...Object.keys(x), ...Object.keys(y)])].map((k) => [k, (x[k] ?? 0) + (y[k] ?? 0)]));
  return { requests: combine(a.requests, b.requests), limits: combine(a.limits, b.limits), missingRequests: counts(a.missingRequests, b.missingRequests), unboundedLimits: counts(a.unboundedLimits, b.unboundedLimits), errors: [...a.errors, ...b.errors] };
}
function effectiveContainer(container: Record<string, unknown>, status: Record<string, unknown>, kind: 'requests' | 'limits', infeasible: boolean, errors: string[]) {
  const declared = normalized(objectRecord(container.resources)[kind], errors);
  if (!status.resources) return declared;
  const actuated = normalized(objectRecord(status.resources)[kind], errors);
  const allocated = kind === 'requests' ? normalized(status.allocatedResources, errors) : {};
  if (infeasible) return kind === 'requests' ? combine(actuated, allocated, 'max') : actuated;
  return combine(combine(declared, actuated, 'max'), allocated, 'max');
}
function aggregatePod(spec: Record<string, unknown>, status: Record<string, unknown>, kind: 'requests' | 'limits', errors: string[]) {
  const infeasible = status.resize === 'Infeasible' || objectArray(status.conditions).some((c) => c.type === 'PodResizePending' && c.reason === 'Infeasible');
  const effective = (c: Record<string, unknown>, init: boolean) => effectiveContainer(c, init && c.restartPolicy !== 'Always' ? {} : objectArray(status[init ? 'initContainerStatuses' : 'containerStatuses']).find((s) => s.name === c.name) ?? {}, kind, infeasible, errors);
  let total: Record<string, string> = {}, sidecars: Record<string, string> = {}, peak: Record<string, string> = {};
  for (const c of objectArray(spec.containers)) total = combine(total, effective(c, false));
  for (const c of objectArray(spec.initContainers)) {
    const resources = effective(c, true);
    if (c.restartPolicy === 'Always') { sidecars = combine(sidecars, resources); total = combine(total, resources); peak = combine(peak, sidecars, 'max'); }
    else peak = combine(peak, combine(sidecars, resources), 'max');
  }
  total = combine(total, peak, 'max');
  if (kind === 'requests') for (const claim of objectArray(status.nodeAllocatableResourceClaimStatuses)) total = combine(total, normalized(claim.resources, errors));
  const podResources = normalized(objectRecord(spec.resources)[kind], errors);
  const effectivePod = effectiveContainer(spec, status, kind, infeasible, errors);
  for (const key of Object.keys(podResources)) if (key === 'cpu' || key === 'memory' || key.startsWith('hugepages-')) total[key] = effectivePod[key] ?? '0';
  const overhead = normalized(spec.overhead, errors);
  for (const [key, value] of Object.entries(overhead)) if (kind === 'requests' || (total[key] && quantity(total[key]!) > 0n)) total[key] = decimalValue(quantity(total[key] ?? '0') + quantity(value));
  return total;
}
function zeroLimit(value: unknown) { try { return quantity(String(value)) === 0n; } catch { return false; } }
export function podDemand(pod: ResourceObject): ClusterDemand {
  const spec = objectRecord(pod.spec), status = objectRecord(pod.status), result = emptyDemand();
  result.requests = aggregatePod(spec, status, 'requests', result.errors);
  result.limits = aggregatePod(spec, status, 'limits', result.errors);
  const containers = [...objectArray(spec.containers), ...objectArray(spec.initContainers)];
  const keys = new Set(['cpu', 'memory', 'ephemeral-storage', ...Object.keys(result.requests), ...Object.keys(result.limits)]);
  for (const key of keys) {
    const podRequests = objectRecord(objectRecord(spec.resources).requests), podLimits = objectRecord(objectRecord(spec.resources).limits);
    result.missingRequests[key] = podRequests[key] ? 0 : containers.filter((c) => !objectRecord(objectRecord(c.resources).requests)[key]).length;
    result.unboundedLimits[key] = podLimits[key] ? 0 : containers.filter((c) => !objectRecord(objectRecord(c.resources).limits)[key] || zeroLimit(objectRecord(objectRecord(c.resources).limits)[key])).length;
  }
  return result;
}
export const activePod = (pod: ResourceObject) => !['Succeeded', 'Failed'].includes(String(objectRecord(pod.status).phase));
