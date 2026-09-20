import type { ProjectSummaryDetail } from '@crewstation/contracts';
import { Link } from '@tanstack/react-router';
import { PROJECT_PATHS } from '../../../../shared/project/projectPaths';
import type { ProjectSpace } from '../../../../shared/project/projectPaths';
import { useT } from '../../../../shared/lib/useT';
import { projectNextAction } from '../../model/projectSummaryState';
import styles from './ProjectSummary.module.css';

export function ProjectSummaryActions({ item, space, available }: { readonly item: ProjectSummaryDetail; readonly space: ProjectSpace; readonly available: boolean }) {
  const t = useT(), action = available ? projectNextAction(item) : undefined, params = { projectId: item.project.id };
  return <div className={styles.actions}>
    {action?.type === 'provision' ? <Link data-primary-project-action className={styles.primary} to={item.role === 'admin' ? '/admin/projects/$projectId/provisioning' : '/projects/$projectId/provisioning'} params={params}>{t(action.label)}</Link> : null}
    {action?.type === 'release' ? <><Link data-primary-project-action className={styles.primary} to={PROJECT_PATHS[space].release} params={params} search={{ release: action.release.id }}>{t(action.label, { tag: action.release.tag })}</Link>
      <Link to={PROJECT_PATHS[space].development} params={params}>{t('projects.summary.continue')}</Link></> : null}
    {action?.type === 'develop' ? <Link data-primary-project-action className={styles.primary} to={PROJECT_PATHS[space].development} params={params}>{t(action.label)}</Link> : null}
    {available && item.role !== 'admin' && item.role !== 'owner' && (item.project.state === 'failed' || item.project.state === 'provisioning') ? <span className={styles.muted}>{t('projects.summary.contactAdmin')}</span> : null}
  </div>;
}
