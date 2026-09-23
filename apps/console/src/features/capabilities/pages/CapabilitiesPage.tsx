import type { CapabilityDescriptionDto } from '@crewstation/contracts';
import { CapabilityDescriptionDtoSchema } from '@crewstation/contracts';
import type { ResourceSection, GuideTopic } from '../../../shared/project/resourceSearch';
import type { ReactElement } from 'react';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiQuery } from '../../../shared/api/useApi';
import { formatDateTime } from '../../../shared/lib/dateFormat';
import { useI18n } from '../../../shared/lib/useI18n';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { CapabilityConfigKeys } from '../components/CapabilityConfigKeys';
import { CapabilityConventions } from '../components/CapabilityConventions';
import { CapabilityIdentity } from '../components/CapabilityIdentity';
import { CapabilityData, CapabilityOperations, CapabilitySubscriptions } from '../components/CapabilityResources';
import { CapabilityBusinessTaskApi, CapabilityMcp, CapabilityQuota } from '../components/CapabilityRuntime';
import styles from './CapabilitiesPage.module.css';

/** 能力说明：一次取回聚合描述，按它实际包含的段落逐段呈现，值都可复制。 */
export function CapabilitiesPage({ embedded = false, section, topic }: { readonly embedded?: boolean; readonly section?: ResourceSection; readonly topic?: GuideTopic }): ReactElement {
  const t = useT();
  const { locale } = useI18n();
  const { projectId } = useProjectScope();
  const description = useApiQuery(queryKeys.capabilities(projectId), async () => {
    const parsed = CapabilityDescriptionDtoSchema.safeParse(await api.capabilities.describe(projectId));
    if (!parsed.success) throw new Error(t('capabilities.invalidResponse'));
    return parsed.data;
  });
  return (
    <>
      {!embedded ? <PageHeader
        title={t('capabilities.title')}
        description={[t('capabilities.line1'), t('capabilities.line2')]}
        actions={
          description.data === undefined ? undefined : (
            <Badge tone="neutral">{t('capabilities.generatedAt', { time: formatDateTime(description.data.generatedAt, locale) })}</Badge>
          )
        }
      /> : null}
      {description.isPending ? <p className={styles.muted}>{t('capabilities.loading')}</p> : null}
      {description.error ? <><EmptyState title={t('capabilities.error', { message: errorMessage(description.error) })} /><Button onClick={() => { void description.refetch(); }}>{t('capabilities.retry')}</Button></> : null}
      {description.data !== undefined ? <CapabilitySections description={description.data} section={section} topic={topic} /> : null}
    </>
  );
}

/** 旧聚合契约按使用目的拆开，全部字段仍保留在对应主题。 */
function CapabilitySections({ description: d, section, topic }: { readonly description: CapabilityDescriptionDto; readonly section?: ResourceSection; readonly topic?: GuideTopic }): ReactElement {
  const t = useT();
  if (section === 'guide') return <div className={styles.stack}>
    <details open={topic === 'identity'} key={`identity:${topic}`}><summary>{t('resources.guide.identity')}</summary><CapabilityConventions conventions={d.conventions} forwarding={d.identityForwarding} groups={['identityHeaders']} /></details>
    <details open={topic === 'environment'} key={`environment:${topic}`}><summary>{t('resources.guide.environment')}</summary><CapabilityConventions conventions={d.conventions} forwarding={d.identityForwarding} groups={['env', 'paths', 'eventHeaders']} showForwarding={false} /><CapabilityConfigKeys config={d.config} /></details>
    <details open={topic === 'mcp'} key={`mcp:${topic}`}><summary>{t('capabilities.mcp.title')}</summary><CapabilityMcp mcp={d.mcp} /></details>
    <details open={topic === 'tasks'} key={`tasks:${topic}`}><summary>{t('capabilities.businessTaskApi.title')}</summary><CapabilityBusinessTaskApi endpoints={d.businessTaskApi} /></details>
  </div>;
  return <div className={styles.stack}>
    {/* 项目信息（RFC-020 D6）：地址与服务身份直接可见，配额与套餐在后；项目 ID 一类标识在设置页自己最上面的项目信息卡里。 */}
    {!section || section === 'project' ? <><CapabilityIdentity service={d.service} hosts={d.hosts} /><CapabilityQuota quota={d.quota} plan={d.plan} /></> : null}
    {!section ? <><CapabilityConventions conventions={d.conventions} forwarding={d.identityForwarding} /><CapabilityConfigKeys config={d.config} /><CapabilityMcp mcp={d.mcp} /><CapabilityBusinessTaskApi endpoints={d.businessTaskApi} /></> : null}
    {!section || section === 'data' ? <CapabilityData data={d.data} /> : null}
    {!section || section === 'api' ? <CapabilityOperations operations={d.operations} /> : null}
    {!section || section === 'events' ? <CapabilitySubscriptions subscriptions={d.subscriptions} /> : null}
  </div>;
}
