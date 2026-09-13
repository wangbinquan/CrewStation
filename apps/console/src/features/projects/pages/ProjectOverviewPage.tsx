import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ProjectStateBadge } from '../components/ProjectStateBadge';
import { SlotsSection } from '../components/SlotsSection';
import { useProjectOwnership } from '../model/useProjectOwnership';
import { useProjectService } from '../model/useProjectService';
import styles from './ProjectOverviewPage.module.css';

/** 项目概览保留运行版本，成员、仓库与资源通过设置入口查看。 */
export function ProjectOverviewPage(): ReactElement {
  const t = useT();
  const { projectId } = useProjectScope();
  const { project, serviceId, isPending, error } = useProjectService(projectId);
  const { isOwner } = useProjectOwnership(projectId);
  return (
    <>
      <PageHeader
        title={project?.name ?? t('projects.overview.title')}
        actions={
          <Link to="/projects/$projectId/release" params={{ projectId }} className={styles.action}>
            {t('projects.overview.goRelease')}
          </Link>
        }
      />
      {project !== undefined ? (
        <div className={styles.identity}>
          <code>{project.slug}</code>
          <span>{t(`projects.kind.${project.kind}`)}</span>
          <ProjectStateBadge state={project.state} />
        </div>
      ) : null}
      {project?.state === 'failed' && project.message !== undefined ? (
        <p className={styles.failure} role="alert">
          {t('projects.list.failureLabel')}
          {project.message}
        </p>
      ) : null}
      <QueryStatus isPending={isPending} error={error} loadingKey="projects.overview.loading" errorKey="projects.overview.error" />
      {serviceId === undefined && !isPending ? <p className={styles.note}>{t('projects.overview.noService')}</p> : null}
      {serviceId !== undefined ? <SlotsSection serviceId={serviceId} canSwitch={isOwner} /> : null}
      <div className={styles.identity}>
        <Link to="/projects/$projectId/settings" params={{ projectId }} search={{ tab: 'members' }}>{t('settings.tab.members')}</Link>
        <Link to="/projects/$projectId/settings" params={{ projectId }} search={{ tab: 'repository' }}>{t('settings.tab.repository')}</Link>
        <Link to="/projects/$projectId/settings" params={{ projectId }} search={{ tab: 'resources' }}>{t('settings.tab.resources')}</Link>
      </div>
    </>
  );
}
