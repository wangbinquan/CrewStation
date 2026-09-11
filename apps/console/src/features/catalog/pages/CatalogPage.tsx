import { useParams } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { CatalogContent } from '../components/CatalogContent';

/** 接口目录：调用方身份是项目的服务，先解析 serviceId，再按它取目录与授权。 */
export function CatalogPage(): ReactElement {
  const t = useT();
  const { projectId } = useParams({ from: '/projects/$projectId' });
  const project = useApiQuery(queryKeys.project(projectId), () => api.projects.get(projectId));
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const serviceId = project.data?.serviceId;
  return (
    <>
      <PageHeader title={t('catalog.title')} description={[t('catalog.line1'), t('catalog.line2'), t('catalog.line3')]} />
      {project.isPending ? <p>{t('catalog.service.loading')}</p> : null}
      {project.error ? <EmptyState title={t('catalog.error.load', { message: errorMessage(project.error) })} /> : null}
      {!project.isPending && project.error === null && serviceId === undefined ? (
        <EmptyState title={t('catalog.service.missingTitle')} description={t('catalog.service.missingDescription')} />
      ) : null}
      {serviceId !== undefined ? <CatalogContent projectId={projectId} serviceId={serviceId} isAdmin={me.data?.isAdmin === true} /> : null}
    </>
  );
}
