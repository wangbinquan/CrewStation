import type { ProjectSummaryDetail } from '@crewstation/contracts';
import { PROJECT_PATHS } from '../../../../shared/project/projectPaths';
import type { ProjectSpace } from '../../../../shared/project/projectPaths';
import { useT } from '../../../../shared/lib/useT';
import { projectNextAction } from '../../model/projectSummaryState';
import styles from './ProjectSummary.module.css';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';

export function ProjectSummaryActions({ item, space, available }: { readonly item: ProjectSummaryDetail; readonly space: ProjectSpace; readonly available: boolean }) {
  const t = useT(), action = available ? projectNextAction(item) : undefined, params = { projectId: item.project.id };
  return <div className={styles.actions}>
    {action?.type === 'provision' ? <ButtonLink data-primary-project-action variant="primary" to={item.role === 'admin' ? '/admin/projects/$projectId/provisioning' : '/projects/$projectId/provisioning'} params={params}>{t(action.label)}</ButtonLink> : null}
    {action?.type === 'release' ? <><ButtonLink data-primary-project-action variant="primary" to={PROJECT_PATHS[space].release} params={params} search={{ release: action.release.id }}>{t(action.label, { tag: action.release.tag })}</ButtonLink>
      <ButtonLink to={PROJECT_PATHS[space].development} params={params}>{t('projects.summary.continue')}</ButtonLink></> : null}
    {action?.type === 'develop' ? <ButtonLink data-primary-project-action variant="primary" to={PROJECT_PATHS[space].development} params={params}>{t(action.label)}</ButtonLink> : null}
    {available && item.role !== 'admin' && item.role !== 'owner' && (item.project.state === 'failed' || item.project.state === 'provisioning') ? <span className={styles.muted}>{t('projects.summary.contactAdmin')}</span> : null}
  </div>;
}
