import type { ProjectSummaryDetail } from '@crewstation/contracts';
import { Link } from '@tanstack/react-router';
import { PROJECT_PATHS } from '../../../../shared/project/projectPaths';
import type { ProjectSpace } from '../../../../shared/project/projectPaths';
import { useT } from '../../../../shared/lib/useT';
import { summaryIsFresh } from '../../model/projectSummaryState';
import styles from './ProjectSummary.module.css';

type NextStep = { readonly tone: 'info' | 'warning'; readonly title: string; readonly hint: string; readonly releaseId?: string };

/** 只从尚有效的发布与部署槽事实推导“下一步”，不猜测流水线进度；没有明确的下一步就不显示。 */
export function nextStep(item: ProjectSummaryDetail, t: (key: string, values?: Record<string, string | number>) => string): NextStep | undefined {
  if (item.role === 'tester') return undefined;
  const latest = item.releases.status === 'ready' && summaryIsFresh(item.releases) ? item.releases.value[0] : undefined;
  if (latest && !['ready', 'superseded', 'failed'].includes(latest.status)) return { tone: 'info', title: t('projects.summary.next.releaseOngoing', { tag: latest.tag, status: t(`release.status.${latest.status}`) }), hint: t('projects.summary.next.releaseOngoingHint'), releaseId: latest.id };
  if (latest?.status === 'failed') return { tone: 'warning', title: t('projects.summary.next.releaseFailed', { tag: latest.tag }), hint: t('projects.summary.next.releaseFailedHint'), releaseId: latest.id };
  if (item.slots.status !== 'ready' || !summaryIsFresh(item.slots)) return undefined;
  const preview = item.slots.value.find((s) => s.name === 'preview'), prod = item.slots.value.find((s) => s.name === 'prod');
  if (!preview || preview.state !== 'ready' || !preview.releaseId || !preview.tag || preview.releaseId === prod?.releaseId) return undefined;
  return prod?.releaseId
    ? { tone: 'info', title: t('projects.summary.next.previewReady', { tag: preview.tag }), hint: t('projects.summary.next.previewReadyHint'), releaseId: preview.releaseId }
    : { tone: 'info', title: t('projects.summary.next.noProduction', { tag: preview.tag }), hint: t('projects.summary.next.noProductionHint'), releaseId: preview.releaseId };
}

export function ProjectNextStepBanner({ item, space }: { readonly item: ProjectSummaryDetail; readonly space: ProjectSpace }) {
  const t = useT(), step = nextStep(item, t);
  if (!step) return null;
  return <div className={styles.banner} data-tone={step.tone} role="status">
    <div><strong>{step.title}</strong><p className={styles.muted}>{step.hint}</p></div>
    {step.releaseId ? <Link to={PROJECT_PATHS[space].release} params={{ projectId: item.project.id }} search={{ release: step.releaseId }}>{t('projects.summary.next.viewRelease')}</Link> : null}
  </div>;
}
