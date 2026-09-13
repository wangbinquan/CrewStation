import type { ProjectSummaryDetail } from '@crewstation/contracts';
import { Link } from '@tanstack/react-router';
import { PROJECT_PATHS } from '../../../../shared/project/projectPaths';
import type { ProjectSpace } from '../../../../shared/project/projectPaths';
import { useT } from '../../../../shared/lib/useT';
import { useDateText } from '../../../../shared/lib/useDateText';
import { Card } from '../../../../shared/ui/Card';
import { summaryIsFresh } from '../../model/projectSummaryState';
import { SummaryUnavailable } from './SummaryFacts';
import styles from './ProjectSummary.module.css';

export function ProjectRecentActivity({ item, space }: { readonly item: ProjectSummaryDetail; readonly space: ProjectSpace }) {
  const t = useT(), date = useDateText(), params = { projectId: item.project.id };
  return <Card compact title={t('projects.summary.activity')} footer={t('projects.summary.activityLimit')}>
    <h3>{t('projects.summary.releases')}</h3>{item.releases.status !== 'ready' || !summaryIsFresh(item.releases) ? <SummaryUnavailable part={item.releases} /> :
      item.releases.value.length === 0 ? <p className={styles.muted}>{t('projects.summary.noReleases')}</p> : <ul className={styles.activity}>{item.releases.value.map((r) => <li key={r.id}>
        <Link to={PROJECT_PATHS[space].release} params={params} search={{ release: r.id }}>{r.tag} · {t(`release.status.${r.status}`)}</Link><small>{date(r.createdAt)}</small>
      </li>)}</ul>}
    <h3>{t('projects.summary.switches')}</h3>{item.switches.status !== 'ready' || !summaryIsFresh(item.switches) ? <SummaryUnavailable part={item.switches} /> :
      item.switches.value.length === 0 ? <p className={styles.muted}>{t('projects.summary.noSwitches')}</p> : <ul className={styles.activity}>{item.switches.value.map((s) => <li key={s.id}>
        <Link to={PROJECT_PATHS[space].release} params={params} search={{ release: s.releaseId }}>{s.reason || t('projects.summary.trafficRecorded')}</Link><small>{date(s.createdAt)}</small>
      </li>)}</ul>}
  </Card>;
}
