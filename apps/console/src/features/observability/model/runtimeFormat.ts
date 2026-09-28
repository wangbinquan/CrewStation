import type { RuntimeUsageMetrics } from '@crewstation/contracts';
const grouped = (count: string) => BigInt(count).toLocaleString();
export function runtimeTokens(m: RuntimeUsageMetrics, bucket?: 'input' | 'cacheRead' | 'cacheWrite' | 'output'): string {
  const value = bucket ? m.tokens[bucket] : m.tokens.total, unknown = bucket ? m.tokens.unknownBuckets[bucket] > 0 : !m.tokens.hasKnown;
  if (unknown && value === '0') return '—';
  return `${m.tokens.complete ? '' : '≥ '}${grouped(value)}`;
}
export function runtimeCny(m: RuntimeUsageMetrics): string {
  const amount = m.cost.amount; if (amount === null || !m.cost.visible) return '—';
  const [whole = '0', fraction = ''] = amount.split('.'), picos = BigInt(whole) * 1000000000000n + BigInt(fraction.padEnd(12, '0'));
  if (picos > 0n && picos < 1000000n) return m.cost.complete ? '< ¥0.000001' : `≥ ¥${whole}.${fraction.replace(/0+$/, '')}`;
  const micros = (picos + (m.cost.complete ? 500000n : 0n)) / 1000000n, tail = (micros % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${m.cost.complete ? '' : '≥ '}¥${grouped((micros / 1000000n).toString())}${tail ? '.' + tail : ''}`;
}
export function runtimeDuration(ms: number | null): string { if (ms === null) return '—'; return ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60000).toFixed(1)} min`; }
export function runtimeDate(at: string, zone?: string): string { return new Intl.DateTimeFormat(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', ...(zone ? { timeZone: zone } : {}) }).format(new Date(at)); }
