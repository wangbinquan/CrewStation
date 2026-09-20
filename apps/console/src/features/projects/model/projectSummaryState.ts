import type { ProjectSummaryDetail } from '@crewstation/contracts';

export function summaryIsFresh(part: { checkedAt: string }, now = Date.now()): boolean {
  const age = now - Date.parse(part.checkedAt); return Number.isFinite(age) && age >= -5000 && age < 30_000;
}
/** 主动作只依据尚有效的当前来源；点击进入实际操作页，概览不直接写入。 */
export function projectNextAction(item: ProjectSummaryDetail) {
  if (!summaryIsFresh(item)) return undefined;
  if (item.project.state === 'failed' || item.project.state === 'provisioning') return item.role === 'admin' || item.role === 'owner'
    ? { type: 'provision' as const, label: item.project.state === 'failed' ? 'projects.summary.fixProvision' : 'projects.summary.checkProvision' } : undefined;
  if (item.project.state !== 'active' || item.role === 'tester') return undefined;
  const latest = item.releases.status === 'ready' && summaryIsFresh(item.releases) ? item.releases.value[0] : undefined;
  if (latest?.status === 'failed') return { type: 'release' as const, label: 'projects.summary.fixRelease', release: latest };
  if (item.development.status !== 'ready' || !summaryIsFresh(item.development)) return undefined;
  return { type: 'develop' as const, label: item.development.value ? 'projects.summary.continue' : 'projects.summary.start' };
}
