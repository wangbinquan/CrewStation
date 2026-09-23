import type { ApiOperationDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { Button } from '../../../shared/ui/Button';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { CatalogContent } from '../components/CatalogContent';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import { ActionRow } from '../../../shared/ui/ActionRow';

/** 接口目录：调用方身份是项目的服务，先解析 serviceId，再按它取目录与授权。 */
export function CatalogPage({ embedded = false, compact = false, fill = false, proxy, operation, onClearContext, onSelect }: { readonly embedded?: boolean; /** 紧凑形态（参考面板在侧栏时）：只列已授权操作与试调。 */ readonly compact?: boolean; /** 紧凑形态在工具面板里：内容短时把最后一张卡拉到面板底边。 */ readonly fill?: boolean; readonly proxy?: string; readonly operation?: string; readonly onClearContext?: () => void; readonly onSelect?: (operation: ApiOperationDto | undefined) => void }): ReactElement {
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
      {serviceId !== undefined ? <CatalogContent key={`${projectId}:${proxy ?? ''}`} projectId={projectId} serviceId={serviceId} canDevelop={canDevelop && !project.error} compact={compact} fill={fill} proxy={proxy} operation={operation} onClearContext={onClearContext} onSelect={onSelect} /> : null}
      {/* 管理员的管理动作留在管理空间（RFC-002）；这里只留一行入口，不再放在页首。 */}
      {!compact && !me.error && me.data?.isAdmin === true ? <ActionRow><ButtonLink to="/admin/capabilities" search={{ tab: 'api', projectId, proxy, operation }}>{t('catalog.admin.openManagement')}</ButtonLink><ButtonLink to="/admin/requests" search={{ projectId, state: 'pending' }}>{t('catalog.admin.openRequests')}</ButtonLink></ActionRow> : null}
    </>
  );
}
