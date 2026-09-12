import type { CapabilityDescriptionDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { projectRoute } from '../../../app/router/projectRoute';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiQuery } from '../../../shared/api/useApi';
import { formatDateTime } from '../../../shared/lib/dateFormat';
import { useI18n } from '../../../shared/lib/useI18n';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { CapabilityConfigKeys } from '../components/CapabilityConfigKeys';
import { CapabilityConventions } from '../components/CapabilityConventions';
import { CapabilityIdentity } from '../components/CapabilityIdentity';
import { CapabilityData, CapabilityOperations, CapabilitySubscriptions } from '../components/CapabilityResources';
import { CapabilityBusinessTaskApi, CapabilityMcp, CapabilityQuota } from '../components/CapabilityRuntime';
import styles from './CapabilitiesPage.module.css';

/** 能力说明：一次取回聚合描述，按它实际包含的段落逐段呈现，值都可复制。 */
export function CapabilitiesPage(): ReactElement {
  const t = useT();
  const { locale } = useI18n();
  const { projectId } = projectRoute.useParams();
  const description = useApiQuery(queryKeys.capabilities(projectId), () => api.capabilities.describe(projectId));
  return (
    <>
      <PageHeader
        title={t('capabilities.title')}
        description={[t('capabilities.line1'), t('capabilities.line2')]}
        actions={
          description.data === undefined ? undefined : (
            <Badge tone="neutral">{t('capabilities.generatedAt', { time: formatDateTime(description.data.generatedAt, locale) })}</Badge>
          )
        }
      />
      {description.isPending ? <p className={styles.muted}>{t('capabilities.loading')}</p> : null}
      {description.error ? <EmptyState title={t('capabilities.error', { message: errorMessage(description.error) })} /> : null}
      {description.data !== undefined ? <CapabilitySections description={description.data} /> : null}
    </>
  );
}

/** 段落顺序：先身份与地址，再约定与配置，最后资源、操作、事件、配额与 MCP。 */
function CapabilitySections({ description }: { readonly description: CapabilityDescriptionDto }): ReactElement {
  return (
    <div className={styles.stack}>
      <CapabilityIdentity service={description.service} hosts={description.hosts} />
      <CapabilityConventions conventions={description.conventions} />
      <CapabilityConfigKeys config={description.config} />
      <CapabilityData data={description.data} />
      <CapabilityOperations operations={description.operations} />
      <CapabilitySubscriptions subscriptions={description.subscriptions} />
      <CapabilityQuota quota={description.quota} plan={description.plan} />
      <CapabilityMcp mcp={description.mcp} />
      <CapabilityBusinessTaskApi endpoints={description.businessTaskApi} />
    </div>
  );
}
