import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { CreateProjectForm } from '../components/CreateProjectForm';
import { ProjectTable } from '../components/ProjectTable';
import { QueryStatus } from '../components/QueryStatus';
import styles from './ProjectListPage.module.css';

/** 首页：管理员看全部项目并可代建，成员只看自己参与的项目。 */
export function ProjectListPage(): ReactElement {
  const t = useT();
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const projects = useApiQuery(queryKeys.projects(), () => api.projects.list());
  const isAdmin = me.data?.isAdmin === true;
  const items = projects.data?.items ?? [];
  const settled = !projects.isPending && projects.error === null;
  return (
    <>
      <PageHeader title={t('projects.list.title')} description={[t('projects.list.line1'), t('projects.list.line2')]} />
      {isAdmin ? (
        <div className={styles.create}>
          <CreateProjectForm />
        </div>
      ) : null}
      <Card title={t('projects.list.cardTitle')}>
        <QueryStatus isPending={projects.isPending} error={projects.error} loadingKey="projects.list.loading" errorKey="projects.list.error" />
        {settled && items.length === 0 ? <EmptyState title={t('projects.list.emptyTitle')} description={t('projects.list.emptyDescription')} /> : null}
        {items.length > 0 ? <ProjectTable projects={items} isAdmin={isAdmin} /> : null}
      </Card>
    </>
  );
}
