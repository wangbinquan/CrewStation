import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { projectRoute } from '../../../app/router/projectRoute';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { MembersCard } from '../components/MembersCard';
import { ProjectStateBadge } from '../components/ProjectStateBadge';
import { QuotaCard } from '../components/QuotaCard';
import { RepositoryCard } from '../components/RepositoryCard';
import { SlotsSection } from '../components/SlotsSection';
import { useProjectOwnership } from '../model/useProjectOwnership';
import { useProjectService } from '../model/useProjectService';
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
        <>
          {/* 成员卡里是四列表格＋成员表单，跟两张定义列表卡挤同一行会把操作列挤到卡外，单独占一行。 */}
          <div className={styles.wideCard}>
            <MembersCard projectId={projectId} canManage={isOwner} isAdmin={isAdmin} />
          </div>
          <div className={styles.cards}>
            <QuotaCard projectId={projectId} />
            {serviceId !== undefined ? <RepositoryCard serviceId={serviceId} /> : null}
          </div>
        </>
      ) : null}
    </>
  );
}
