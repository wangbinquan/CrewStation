import type { ProjectSummaryDetail } from '@crewstation/contracts';
import { Link } from '@tanstack/react-router';
import { PROJECT_PATHS } from '../../../../shared/project/projectPaths';
import type { ProjectSpace } from '../../../../shared/project/projectPaths';
import { useT } from '../../../../shared/lib/useT';
import { Card } from '../../../../shared/ui/Card';
import { summaryIsFresh } from '../../model/projectSummaryState';
import styles from './ProjectSummary.module.css';

export function ProjectSummaryAttention({ item, space }: { readonly item: ProjectSummaryDetail; readonly space: ProjectSpace }) {
  const t = useT(), params = { projectId: item.project.id };
  if (item.role === 'tester') return null;
  const healthUnknown = item.health.status !== 'ready' || !summaryIsFresh(item.health) || item.health.value.some((h) => h.state === 'unknown');
  const unhealthy = item.health.status === 'ready' && summaryIsFresh(item.health) && item.health.value.some((h) => !['healthy', 'unknown'].includes(h.state));
  if (!healthUnknown && !unhealthy) return null;
  return <Card compact title={t('projects.summary.attention')}><ul className={styles.activity}>
    {healthUnknown || unhealthy ? <li><Link to={PROJECT_PATHS[space].operations} params={params} search={{ tab: 'health' }}>{t(healthUnknown ? 'projects.summary.checkHealth' : 'projects.summary.fixHealth')}</Link></li> : null}
  </ul></Card>;
}
