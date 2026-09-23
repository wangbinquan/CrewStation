import type { DevelopmentSummary, ProjectSummaryDetail, SlotDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiQuery } from '../../../../shared/api/useApi';
import { PROJECT_PATHS } from '../../../../shared/project/projectPaths';
import type { ProjectSpace } from '../../../../shared/project/projectPaths';
import { DeployedVersionCard } from '../../../../shared/project/DeployedVersionCard';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import type { BadgeTone } from '../../../../shared/ui/Badge';
import { Card } from '../../../../shared/ui/Card';
import { summaryIsFresh } from '../../model/projectSummaryState';
import { SummaryUnavailable } from './SummaryFacts';
import styles from './ProjectSummary.module.css';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';

/** 概览的三张状态卡（RFC-020 §4.2）：正式版本、待验证版本、开发会话；版本卡与发布页同一个组件。 */
export function StatusCards({ item, space, available }: { readonly item: ProjectSummaryDetail; readonly space: ProjectSpace; readonly available: boolean }): ReactElement {
  const t = useT(), projectId = item.project.id, tester = item.role === 'tester';
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
      return <DeployedVersionCard key={name} role={name} slot={slot} known={available} sha="short" health={health(name)}
        actions={name === 'preview' && available && switchTarget ? <ButtonLink variant="primary" size="small" to={PROJECT_PATHS[space].release} params={{ projectId }} search={{ switch: true }}>{t('projects.summary.goLive', { tag: slot?.tag ?? '' })}</ButtonLink> : undefined} />;
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
  const terminals = useApiQuery(queryKeys.nativeTerminals(session?.taskId ?? ''), () => api.devSession.listNativeTerminals(session!.taskId), { enabled: !!session && session.state === 'running', refetchIntervalMs: 30_000 });
  const comparison = useApiQuery(queryKeys.versionComparison(projectId, session?.taskId ?? ''), () => api.devSession.versionComparison(projectId), { enabled: live, staleTimeMs: 60_000 });
  const commits = comparison.data?.commits, workspace = comparison.data?.workspace;
  const open = available && item.project.state === 'active';
  return <Card compact title={t('projects.summary.developmentCard')} extra={session ? <Badge tone={SESSION_TONE[session.state] ?? 'neutral'}>{t(`projects.summary.session.${session.state}`)}</Badge> : undefined}>
    {part.status !== 'ready' || !summaryIsFresh(part) ? <SummaryUnavailable part={part} /> : !session ? <div className={styles.fact}><span className={styles.muted}>{t('projects.summary.noSession')}</span>{open ? <ButtonLink variant="primary" size="small" to={PROJECT_PATHS[space].development} params={{ projectId }}>{t('projects.summary.start')}</ButtonLink> : null}</div>
      : <div className={styles.fact}>
        <span className={styles.sessionLine}><code>{session.branch ?? t('projects.summary.branchUnknown')}</code>{terminals.data && !terminals.error ? ` · ${t('projects.summary.cliCount', { count: terminals.data.items.length })}` : ''}</span>
        <small className={styles.muted}>{t(session.connected ? 'projects.summary.connected' : 'projects.summary.disconnected')}{session.message ? ` · ${session.message}` : ''}</small>
        <small className={styles.muted}>{commits && 'ahead' in commits && workspace?.status === 'ready' ? t('projects.summary.pendingWork', { ahead: commits.ahead, dirty: workspace.uncommittedCount }) : t('projects.summary.unchecked')}</small>
        {open ? <ButtonLink variant="primary" size="small" to={PROJECT_PATHS[space].development} params={{ projectId }}>{t('projects.summary.continue')}</ButtonLink> : null}
      </div>}
  </Card>;
}
