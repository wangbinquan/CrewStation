import { prices, runs } from './fixture';
import type { Attempt, Run, Usage } from './fixture';
export interface Filter { project: string; range: number; environment: string }
export function filteredRuns(filter: Filter): Run[] {
  return runs.filter((run) => (filter.project === 'all' || run.project === filter.project) && run.age < filter.range && (filter.environment === 'all' || run.environment === filter.environment)).sort((a, b) => a.age - b.age);
}
export function tokenTotal(value: Usage | null): number { return value ? value.input + value.read + value.write + value.output : 0; }
export function summarize(items: readonly Attempt[]) {
  const total = items.reduce((sum, item) => sum + tokenTotal(item.usage), 0);
  return { total, known: items.filter((a) => a.usage !== null).length, complete: items.filter((a) => a.complete).length, count: items.length,
    seconds: items.reduce((sum, a) => sum + a.end - a.start, 0), retries: items.filter((a) => a.kind === 'retry').length,
    cost: items.reduce((sum, a) => sum + estimatedCost(a), 0) };
}
export function compact(value: number): string { return value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K` : value.toLocaleString('zh-CN'); }
export function tokenLabel(items: readonly Attempt[]): string {
  const s = summarize(items);
  return !s.count ? '不适用' : !s.known ? '—' : `${s.complete < s.count ? '≥ ' : ''}${compact(s.total)}`;
}
export function duration(seconds: number): string { return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`; }
export function estimatedCost(a: Attempt): number {
  if (a.model === 'unknown') return 0;
  const p = prices[a.model], u = a.usage;
  return u ? (u.input * p.input + u.read * p.read + u.write * p.write + u.output * p.output) / 1e6 : 0;
}
export function formatCny(value: number): string { return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(value); }
export function money(items: readonly Attempt[]): string {
  const s = summarize(items); return !s.count ? '不适用' : !s.known ? '—' : `${s.complete < s.count ? '≥ ' : ''}${formatCny(s.cost)}`;
}
export function buckets(items: readonly Attempt[]): Usage {
  return items.reduce((s, a) => ({ input: s.input + (a.usage?.input ?? 0), read: s.read + (a.usage?.read ?? 0), write: s.write + (a.usage?.write ?? 0), output: s.output + (a.usage?.output ?? 0) }), { input: 0, read: 0, write: 0, output: 0 });
}
export function percentile(values: number[], percentile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)];
}
export function outcome(items: Run[]) {
  const terminal = items.filter((r) => r.kind === 'business' && r.state !== 'running');
  const success = terminal.filter((r) => r.state === 'done').length;
  return { success, count: terminal.length, rate: terminal.length ? `${(success / terminal.length * 100).toFixed(1)}%` : '—', p95: percentile(terminal.map((r) => r.wall), .95) };
}
export function agentGroups(items: Run[]) {
  const grouped = new Map<string, { key: string; name: string; project: string; attempts: Attempt[]; runs: Run[] }>();
  for (const run of items) for (const a of run.attempts) {
    const key = `${run.project}:${a.agent}`;
    const item = grouped.get(key) ?? { key, name: a.agent, project: run.project, attempts: [], runs: [] };
    item.attempts.push(a); if (!item.runs.includes(run)) item.runs.push(run); grouped.set(key, item);
  }
  return [...grouped.values()].sort((a, b) => summarize(b.attempts).total - summarize(a.attempts).total);
}
export function activityUnion(items: Attempt[]): number {
  const sorted = items.map((a) => [a.start, a.end]).sort((a, b) => a[0] - b[0]); let sum = 0, end = 0;
  for (const [from, to] of sorted) { sum += Math.max(0, to - Math.max(from, end)); end = Math.max(end, to); } return sum;
}
export function serviceSeries(project: string, range: number, environment: string) {
  const seed = { code: 7, procurement: 5, knowledge: 4, gitlab: 9 }[project] ?? 7;
  const scale = environment === 'development' ? .2 : environment === 'preview' ? .35 : 1;
  return Array.from({ length: range === 24 ? 24 : 28 }, (_, i) => {
    const requests = Math.round((seed * 17 + (i * 13 % 47)) * scale);
    const errors = project === 'procurement' && i > 17 && i < 21 ? Math.max(1, Math.round(requests * .045)) : i % 9 === 0 ? 1 : 0;
    return { requests, errors, latency: 95 + seed * 12 + i * 7 % 60 + (errors > 2 ? 220 : 0), cpu: +(seed * .12 * scale + i % 6 * .04).toFixed(2) };
  });
}
