// 形态图组装共用的小规则：Pod 状态归一（沿用 RFC-010 §4 口径）、用途到语义、时长文案。全部纯函数，文案经 i18n。
import type { ClusterResource } from '@crewstation/contracts';
import type { Translate } from '../lib/useT';
import type { NodeStatus, Semantic } from '../ui/topology/topologyModel';

export function purposeSemantic(purpose: ClusterResource['purpose']): Semantic {
  switch (purpose) {
    case 'digital-worker-service': case 'api-proxy': case 'event-producer': return 'service';
    case 'development-workspace': case 'development-cli': case 'development-agent': return 'development';
    case 'business-workspace': case 'business-subtask': return 'business';
    case 'build': case 'migration': return 'build';
    default: return 'platform';
  }
}

/** Running 不等于 Ready；异常原因短语原样保留（如 `Insufficient cpu`、`CrashLoopBackOff`）。 */
export function podStatus(r: ClusterResource, t: Translate): { status: NodeStatus; statusText: string } {
  if (r.deletingAt) return { status: 'terminating', statusText: t('topology.status.terminating') };
  if (r.purpose === 'unknown') return { status: 'unknown', statusText: t('topology.status.unknown') };
  if (r.phase === 'Succeeded') return { status: 'succeeded', statusText: t('topology.status.succeeded') };
  if (r.phase === 'Failed') return { status: 'failed', statusText: r.reason || t('topology.status.failed') };
  if (r.abnormal) return { status: r.phase === 'Pending' ? 'pending' : 'failed', statusText: r.reason || r.phase };
  if (r.phase === 'Pending') return { status: 'pending', statusText: r.reason || t('topology.status.pending') };
  if (r.phase === 'Running') return r.ready ? { status: 'ready', statusText: t('topology.status.ready') } : { status: 'running', statusText: t('topology.pod.notReady') };
  return { status: 'unknown', statusText: r.reason || r.phase || t('topology.status.unknown') };
}

export function workloadStatus(r: ClusterResource, t: Translate): { status: NodeStatus; statusText: string } {
  const desired = r.desired ?? 0, ready = r.readyReplicas ?? 0;
  const text = t('topology.workload.replicas', { ready, desired });
  if (r.deletingAt) return { status: 'terminating', statusText: text };
  if (r.kind === 'Job' || r.kind === 'CronJob') return r.phase === 'Succeeded' || r.phase === 'Complete' ? { status: 'succeeded', statusText: t('topology.status.succeeded') } : r.phase === 'Failed' ? { status: 'failed', statusText: r.reason || t('topology.status.failed') } : { status: 'running', statusText: t('topology.status.running') };
  if (r.abnormal) return { status: 'failed', statusText: r.reason || text };
  if (desired === 0) return { status: 'idle', statusText: text };
  return ready >= desired ? { status: 'ready', statusText: text } : { status: 'pending', statusText: `${text} · ${t('topology.workload.rolling')}` };
}

/** 盘点的 facts 值可能是 JSON（如 PVC 的 `{"storage":"10Gi"}`）：取里面的量，读起来是「capacity 10Gi」而不是一段 JSON。 */
export function factText(value: string): string {
  if (!value.startsWith('{')) return value;
  try { const parsed = JSON.parse(value) as Record<string, unknown>; const first = parsed.storage ?? Object.values(parsed)[0]; return typeof first === 'string' || typeof first === 'number' ? String(first) : value; } catch { return value; }
}

export function durationText(fromIso: string | undefined, toIso: string, t: Translate): string | undefined {
  if (!fromIso) return undefined;
  const seconds = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));
  if (Number.isNaN(seconds)) return undefined;
  if (seconds < 60) return t('topology.duration.seconds', { count: seconds });
  if (seconds < 3600) return t('topology.duration.minutes', { count: Math.floor(seconds / 60) });
  if (seconds < 86400) return t('topology.duration.hours', { hours: Math.floor(seconds / 3600), minutes: Math.floor((seconds % 3600) / 60) });
  return t('topology.duration.days', { days: Math.floor(seconds / 86400), hours: Math.floor((seconds % 86400) / 3600) });
}

/** 详情面板用的 Pod 事实：与集群管理同一投影，不含环境变量值、Secret、注解与原始对象。 */
export function podFacts(r: ClusterResource, t: Translate): (readonly [string, string])[] {
  const image = r.containers.find((c) => !c.init)?.image ?? r.containers[0]?.image;
  return [
    [t('topology.fact.purpose'), t(`cluster.purpose.${r.purpose}`)], [t('topology.fact.phase'), r.reason ? `${r.phase} · ${r.reason}` : r.phase], [t('topology.fact.restarts'), String(r.restarts)],
    ...(r.node ? [[t('topology.fact.node'), r.node] as const] : []), ...(image ? [[t('topology.fact.image'), image] as const] : []),
    ...(r.createdAt ? [[t('topology.fact.createdAt'), r.createdAt] as const] : []),
    ...(r.taskId ? [[t('topology.fact.taskId'), r.taskId] as const] : []), ...(r.parentTaskId ? [[t('topology.fact.parentTaskId'), r.parentTaskId] as const] : []),
    ...(r.agentId ? [[t('topology.fact.agentId'), r.agentId] as const] : []), ...(r.terminalId ? [[t('topology.fact.terminalId'), r.terminalId] as const] : []),
    ...(r.releaseId ? [[t('topology.fact.releaseId'), r.releaseId] as const] : []), ...(r.profile ? [[t('topology.fact.profile'), r.profile] as const] : []),
    ...(r.physicalSlot ? [[t('topology.fact.slot'), `${r.physicalSlot}${r.slotRole ? ` · ${r.slotRole}` : ''}`] as const] : []),
    [t('topology.fact.uid'), r.uid],
  ];
}
