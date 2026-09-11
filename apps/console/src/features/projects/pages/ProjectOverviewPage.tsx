import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { projectRoute } from '../../../app/router/projectRoute';
import { useT } from '../../../shared/lib/useT';
import { MembersCard } from '../components/MembersCard';
import { ProjectStateBadge } from '../components/ProjectStateBadge';
import { QuotaCard } from '../components/QuotaCard';
import { RepositoryCard } from '../components/RepositoryCard';
import { SlotsSection } from '../components/SlotsSection';
import { QueryStatus } from '../components/QueryStatus';
import { useProjectOwnership } from '../model/useProjectOwnership';
import { useProjectService } from '../model/useProjectService';
import { PageHeader } from '../../../shared/ui/PageHeader';
import styles from './ProjectOverviewPage.module.css';

/** 项目概览：两个部署槽与切流、成员、配额、仓库。 */
export function ProjectOverviewPage(): ReactElement {
  const t = useT();
  const { projectId } = projectRoute.useParams();
  const { project, serviceId, isPending, error } = useProjectService(projectId);
  const { isAdmin, isOwner } = useProjectOwnership(projectId);
  return (
    <>
      <PageHeader
        title={project?.name ?? t('projects.overview.title')}
        description={[t('projects.overview.line1'), t('projects.overview.line2')]}
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
          <code>{project.namespace}</code>
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
      {project !== undefined ? (
        <div className={styles.cards}>
          <MembersCard projectId={projectId} canManage={isOwner} isAdmin={isAdmin} />
          <QuotaCard projectId={projectId} />
          {serviceId !== undefined ? <RepositoryCard serviceId={serviceId} /> : null}
        </div>
      ) : null}
    </>
  );
}
