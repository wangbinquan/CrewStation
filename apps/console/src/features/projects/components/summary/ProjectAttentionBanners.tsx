import type { ProjectSummaryDetail } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiQuery } from '../../../../shared/api/useApi';
import { PROJECT_PATHS } from '../../../../shared/project/projectPaths';
import type { ProjectSpace } from '../../../../shared/project/projectPaths';
import { useT } from '../../../../shared/lib/useT';
import { summaryIsFresh } from '../../model/projectSummaryState';
import { useAccessRequestReview } from '../../model/useAccessRequestReview';
import styles from './ProjectSummary.module.css';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';

/**
 * 概览只说需要处理的事（RFC-020 §6）：运行健康异常或未知、负责人有待批准的数据访问申请、待处理的应用使用申请（2026-09-24）。没有就不显示。
 * 健康的家在运行与诊断 → 状态；这里只是一条带上下文的入口。
 */
export function ProjectAttentionBanners({ item, space }: { readonly item: ProjectSummaryDetail; readonly space: ProjectSpace }) {
  const t = useT(), params = { projectId: item.project.id }, manager = item.role === 'owner' || item.role === 'admin';
  const pending = useApiQuery(queryKeys.pendingDataBindings(item.project.id), () => api.tasks.listProjectDataBindings(item.project.id, { state: 'requested' }), { enabled: manager && item.project.state === 'active', refetchIntervalMs: 30_000 });
  const access = useAccessRequestReview({ projectId: item.project.id, state: 'pending' }, manager && item.project.kind === 'DigitalWorker').requests;
  if (item.role === 'tester') return null;
  const healthUnknown = item.health.status !== 'ready' || !summaryIsFresh(item.health) || item.health.value.some((h) => h.state === 'unknown');
  const unhealthy = item.health.status === 'ready' && summaryIsFresh(item.health) && item.health.value.some((h) => !['healthy', 'unknown'].includes(h.state));
  const count = manager && !pending.error ? pending.data?.items.length ?? 0 : 0;
  const waiting = manager && !access.error ? access.data?.items.length ?? 0 : 0, more = access.data?.nextCursor ? '+' : '';
  return <>
    {unhealthy || healthUnknown ? <div className={styles.banner} data-tone={unhealthy ? 'warning' : 'info'} role="status">
      <div><strong>{t(unhealthy ? 'projects.summary.attention.unhealthy' : 'projects.summary.attention.healthUnknown')}</strong><p className={styles.muted}>{t('projects.summary.attention.healthHint')}</p></div>
      <ButtonLink to={PROJECT_PATHS[space].operations} params={params} search={{ tab: 'health' }}>{t(unhealthy ? 'projects.summary.fixHealth' : 'projects.summary.checkHealth')}</ButtonLink>
    </div> : null}
    {count > 0 ? <div className={styles.banner} data-tone="info" role="status">
      <div><strong>{t('projects.summary.attention.dataAccess', { count })}</strong><p className={styles.muted}>{t('projects.summary.attention.dataAccessHint')}</p></div>
      <ButtonLink to={PROJECT_PATHS[space].development} params={params} search={{ view: 'data' }}>{t('projects.summary.attention.openData')}</ButtonLink>
    </div> : null}
    {waiting > 0 ? <div className={styles.banner} data-tone="info" role="status">
      <div><strong>{t('projects.summary.attention.accessRequests', { count: `${waiting}${more}` })}</strong><p className={styles.muted}>{t('projects.summary.attention.accessRequestsHint')}</p></div>
      <ButtonLink to={PROJECT_PATHS[space].settings} params={params} search={{ tab: 'visibility' }}>{t('projects.summary.attention.openAccess')}</ButtonLink>
    </div> : null}
  </>;
}
