import type { DevelopmentSummary, ProjectSummaryDetail, SlotDto } from '@crewstation/contracts';
import { isLiveResourcePhase } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiQuery } from '../../../../shared/api/useApi';
import { PROJECT_PATHS } from '../../../../shared/project/projectPaths';
import { resourcePhaseTone } from '../../../../shared/resources/resourcePhaseTone';
import { useProjectResources } from '../../../../shared/resources/useProjectResources';
import type { ProjectSpace } from '../../../../shared/project/projectPaths';
import { DeployedVersionCard } from '../../../../shared/project/DeployedVersionCard';
import { useServiceMaintenance } from '../../../../shared/project/useServiceMaintenance';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import type { BadgeTone } from '../../../../shared/ui/Badge';
import { Card } from '../../../../shared/ui/Card';
import { summaryIsFresh } from '../../model/projectSummaryState';
import { SummaryUnavailable } from './SummaryFacts';
import styles from './ProjectSummary.module.css';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';

/** 概览的三张状态卡（RFC-020 §4.2）：正式版本、待验证版本、开发会话；版本卡与发布页同一个组件，维护角标与到期提示也一样（RFC-021）。 */
export function StatusCards({ item, space, available }: { readonly item: ProjectSummaryDetail; readonly space: ProjectSpace; readonly available: boolean }): ReactElement {
  const t = useT(), projectId = item.project.id, tester = item.role === 'tester', maintenance = useServiceMaintenance(item.project.serviceId);
  const slotOf = (name: 'prod' | 'preview'): { slot?: SlotDto; known: boolean; part: { status: string; checkedAt: string } | undefined } => {
    const part = name === 'preview' && tester ? item.preview : item.slots;
    if (!part || part.status !== 'ready' || !summaryIsFresh(part)) return { known: false, part };
    const slot = Array.isArray(part.value) ? part.value.find((s) => s.name === name) : part.value ?? undefined;
    return { slot, known: true, part };
  };
  const health = (name: 'prod' | 'preview') => item.health.status === 'ready' && summaryIsFresh(item.health) ? item.health.value.find((h) => h.slot === name)?.state : undefined;
  const switchTarget = !tester && (item.role === 'owner' || item.role === 'admin') && slotOf('preview').slot?.state === 'ready' && slotOf('preview').slot?.releaseId && slotOf('preview').slot?.releaseId !== slotOf('prod').slot?.releaseId;
  return <div className={styles.statusGrid}>
    {(['prod', 'preview'] as const).map((name) => {
      const { slot, known, part } = slotOf(name);
      if (!part) return <Card key={name} compact title={t(`slot.${name}`)}><span className={styles.muted}>{t('projects.summary.unknown')}</span></Card>;
      if (!known) return <Card key={name} compact title={t(`slot.${name}`)}><SummaryUnavailable part={part} /></Card>;
      return <DeployedVersionCard key={name} role={name} slot={slot} known={available} sha="short" health={health(name)} maintenance={name === 'prod' ? maintenance.current : undefined}
        primary={name === 'preview' && available && switchTarget ? <ButtonLink variant="primary" to={PROJECT_PATHS[space].release} params={{ projectId }} search={{ switch: true }}>{t('projects.summary.goLive', { tag: slot?.tag ?? '' })}</ButtonLink> : undefined} />;
    })}
    {tester ? null : <DevelopmentCard item={item} space={space} available={available} />}
  </div>;
}

const SESSION_TONE: Readonly<Record<string, BadgeTone>> = { running: 'success', creating: 'info', paused: 'neutral', releasing: 'neutral', released: 'neutral', failed: 'danger' };

/** 第三张卡：会话状态、分支、CLI 数、待上线与未提交；数字来自真实查询，没有查到就写「未检查」而不是 0。 */
function DevelopmentCard({ item, space, available }: { readonly item: ProjectSummaryDetail; readonly space: ProjectSpace; readonly available: boolean }): ReactElement {
  const t = useT(), projectId = item.project.id, part = item.development;
  const session: DevelopmentSummary | null | undefined = part.status === 'ready' && summaryIsFresh(part) ? part.value : undefined;
  const live = !!session && session.state === 'running' && session.connected;
  const records = useProjectResources(projectId, { enabled: !!session });
  const comparison = useApiQuery(queryKeys.versionComparison(projectId, session?.taskId ?? ''), () => api.devSession.versionComparison(projectId), { enabled: live, staleTimeMs: 60_000 });
  const commits = comparison.data?.commits, workspace = comparison.data?.workspace;
  // 只数在运行的 CLI（RFC-025：来自资源台账的 Agent 执行记录；结束中、已结束、失败的都不算。2026-09-23 盘点：demo 一个都不在跑，卡上却写「14 个 CLI」）。
  const openClis = records.data?.items.filter((record) => record.kind === 'agent-execution' && record.purpose === 'development-cli' && record.parentId === session?.taskId && isLiveResourcePhase(record.phase)).length ?? 0;
  // 会话徽标照台账里这个工作区记录的阶段（RFC-025）；还没进台账的（台账接上之前的会话、刚开的一瞬）按摘要。
  const workspaceRecord = records.data?.items.find((record) => record.kind === 'dev-workspace' && record.id === session?.taskId);
  const phase = workspaceRecord?.phase ?? session?.phase;
  const open = available && item.project.state === 'active', known = part.status === 'ready' && summaryIsFresh(part);
  // 开发会话是一个对象：开始／继续开发放在卡片底部操作条（2026-09-23 裁定）。
  const enter = open && known ? <ButtonLink variant="primary" to={PROJECT_PATHS[space].development} params={{ projectId }}>{t(session ? 'projects.summary.continue' : 'projects.summary.start')}</ButtonLink> : undefined;
  return <Card compact title={t('projects.summary.developmentCard')} extra={session ? phase ? <Badge tone={resourcePhaseTone(phase)}>{t('projects.summary.sessionPhase', { phase: t(`resources.phase.${phase}`) })}</Badge>
    : <Badge tone={SESSION_TONE[session.state] ?? 'neutral'}>{t(`projects.summary.session.${session.state}`)}</Badge> : undefined} actions={enter}>
    {!known ? <SummaryUnavailable part={part} /> : !session ? <div className={styles.fact}><span className={styles.muted}>{t('projects.summary.noSession')}</span></div>
      : <div className={styles.fact}>
        <span className={styles.sessionLine}><code>{session.branch ?? t('projects.summary.branchUnknown')}</code>{records.data && !records.error ? ` · ${t('projects.summary.cliCount', { count: openClis })}` : ''}</span>
        <small className={styles.muted}>{t(session.connected ? 'projects.summary.connected' : 'projects.summary.disconnected')}{session.message ? ` · ${session.message}` : ''}</small>
        <small className={styles.muted}>{commits && 'ahead' in commits && workspace?.status === 'ready' ? t('projects.summary.pendingWork', { ahead: commits.ahead, dirty: workspace.uncommittedCount }) : t('projects.summary.unchecked')}</small>
      </div>}
  </Card>;
}
