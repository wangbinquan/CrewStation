import type { ReactElement } from 'react';
import { Link } from '@tanstack/react-router';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { Button } from '../../../shared/ui/Button';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { CatalogContent } from '../components/CatalogContent';

/** 接口目录：调用方身份是项目的服务，先解析 serviceId，再按它取目录与授权。 */
export function CatalogPage({ embedded = false, proxy, operation, onClearContext }: { readonly embedded?: boolean; readonly proxy?: string; readonly operation?: string; readonly onClearContext?: () => void }): ReactElement {
  const t = useT();
  const { projectId } = useProjectScope();
  const project = useApiQuery(queryKeys.project(projectId), () => api.projects.get(projectId));
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const serviceId = project.data?.serviceId;
  const identityIncomplete = me.data !== undefined && !Array.isArray(me.data.memberships) && me.data.isAdmin !== true;
  const canDevelop = !me.error && !identityIncomplete && (me.data?.isAdmin === true || me.data?.memberships?.some((item) => item.projectId === projectId && (item.role === 'owner' || item.role === 'developer')) === true);
  return (
    <>
      {!embedded ? <PageHeader title={t('catalog.title')} description={[t('catalog.line1'), t('catalog.line2'), t('catalog.line3')]} /> : null}
      {me.error || identityIncomplete ? <p role="alert">{t('catalog.identityUnavailable')} <Button onClick={() => { void me.refetch(); }}>{t('catalog.reloadIdentity')}</Button></p> : null}
      {project.isPending ? <p>{t('catalog.service.loading')}</p> : null}
      {project.error ? <EmptyState title={t('catalog.error.load', { message: errorMessage(project.error) })} /> : null}
      {!project.isPending && project.error === null && serviceId === undefined ? (
        <EmptyState title={t('catalog.service.missingTitle')} description={t('catalog.service.missingDescription')} />
      ) : null}
      {!me.error && me.data?.isAdmin === true ? <p><Link to="/admin/capabilities" search={{ tab: 'api', projectId, proxy, operation }}>{t('catalog.admin.openManagement')}</Link> · <Link to="/admin/requests" search={{ tab: 'api', projectId, state: 'pending' }}>{t('catalog.admin.openRequests')}</Link></p> : null}
      {serviceId !== undefined ? <CatalogContent key={`${projectId}:${proxy ?? ''}:${operation ?? ''}`} projectId={projectId} serviceId={serviceId} canDevelop={canDevelop && !project.error} proxy={proxy} operation={operation} onClearContext={onClearContext} /> : null}
    </>
  );
}
