import type { RuntimeUsageMetrics, RuntimeTaskSummary, RuntimeAttemptFact, RuntimeSourceKind, RuntimeStatistics, RuntimeAgentStatistics } from '@crewstation/contracts';
import type { Translate } from '../../../shared/lib/useT';
export function runtimeTaskName(task: Pick<RuntimeTaskSummary, 'name' | 'source'>, t: Translate): string {
  return task.source?.kind === 'development-agent' ? `${t('runtime.developmentExecution')} · ${task.source.identity.agentId.slice(-8)}` : task.name;
}
export function runtimeAttemptName(task: Pick<RuntimeTaskSummary, 'name' | 'source'>, attempt: RuntimeAttemptFact, t: Translate) { return task.source?.kind === 'development-agent' ? runtimeTaskName(task, t) : attempt.name; }
export function runtimeComputeLabel(profile: { profileName?: string | null; profileRevision: number | null }, t: Translate) { return `${profile.profileName ?? t('runtime.nameUnavailable')} · r${profile.profileRevision ?? '—'}`; }
export function runtimeAgentName(agent: Pick<RuntimeAgentStatistics, 'name' | 'sourceKind' | 'agentId'>, t: Translate) { return agent.sourceKind === 'development-agent' ? `${t('runtime.developmentExecution')} · ${agent.agentId?.slice(-8) ?? ''}` : agent.name; }
export function runtimeSourceLabel(kind: RuntimeSourceKind | undefined, t: Translate) { return t(kind === 'development-agent' ? 'runtime.source.development-agent' : 'runtime.source.business-task'); }
export function runtimeObjectLabel(data: RuntimeStatistics, t: Translate) { return t(data.filters.sourceKind === 'business-task' ? 'runtime.tasks' : data.filters.sourceKind === 'development-agent' ? 'runtime.developmentExecutions' : data.sourceScope === 'project-executions' ? 'runtime.objects' : 'runtime.tasks'); }
export const RUNTIME_TOKEN_BUCKETS = ['input', 'cacheRead', 'cacheWrite', 'output'] as const;
const grouped = (count: string) => BigInt(count).toLocaleString();
export function runtimeTokens(m: RuntimeUsageMetrics, bucket?: 'input' | 'cacheRead' | 'cacheWrite' | 'output'): string {
  const value = bucket ? m.tokens[bucket] : m.tokens.total;
  const hasKnown = m.tokens.hasKnown && (bucket ? m.tokens.hasKnownBuckets?.[bucket] ?? (m.tokens.complete || BigInt(value) > 0n) : true);
  if (!hasKnown) return '—';
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
