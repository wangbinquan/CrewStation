import type { CapabilityDescriptionDto, DataResourceDto, SubscriptionDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { CapabilitySection } from './CapabilitySection';
import { CapabilityTable } from './CapabilityTable';
import { CopyValue } from './CopyValue';

/** 数据资源：注入容器的是环境变量名，值只到容器里，能力说明中不出现。 */
export function CapabilityData({ data }: { readonly data: readonly DataResourceDto[] }): ReactElement {
  const t = useT();
  return (
    <CapabilitySection title={t('capabilities.data.title')} note={t('capabilities.data.note')}>
      <CapabilityTable
        rows={data}
        rowKey={(row) => row.id}
        empty={t('capabilities.data.empty')}
        columns={[
          { header: t('capabilities.data.kind'), cell: (row) => <code>{row.kind}</code> },
          { header: t('capabilities.data.env'), cell: (row) => row.env },
          { header: t('capabilities.data.plan'), cell: (row) => row.plan },
          { header: t('capabilities.data.state'), cell: (row) => <Badge tone={row.state === 'ready' ? 'success' : 'neutral'}>{row.state}</Badge> },
          { header: t('capabilities.data.envVar'), cell: (row) => <CopyValue value={row.envVar} label={row.envVar} /> },
        ]}
      />
    </CapabilitySection>
  );
}

/** 事件订阅：处理路径只在 ACTIVE 生产槽上被调用。 */
export function CapabilitySubscriptions({ subscriptions }: { readonly subscriptions: readonly SubscriptionDto[] }): ReactElement {
  const t = useT();
  return (
    <CapabilitySection title={t('capabilities.subscriptions.title')} note={t('capabilities.subscriptions.note')}>
      <CapabilityTable
        rows={subscriptions}
        rowKey={(row) => row.id}
        empty={t('capabilities.subscriptions.empty')}
        columns={[
          { header: t('capabilities.subscriptions.eventType'), cell: (row) => <CopyValue value={row.eventType} label={row.eventType} /> },
          { header: t('capabilities.subscriptions.handlerPath'), cell: (row) => <CopyValue value={row.handlerPath} label={row.handlerPath} /> },
          { header: t('capabilities.subscriptions.state'), cell: (row) => <Badge tone={row.state === 'active' ? 'success' : 'neutral'}>{row.state}</Badge> },
        ]}
      />
    </CapabilitySection>
  );
}

/** 可调用的操作：与接口目录同源，这里只读且带完整操作键。 */
export function CapabilityOperations({ operations }: { readonly operations: CapabilityDescriptionDto['operations'] }): ReactElement {
  const t = useT();
  return (
    <CapabilitySection title={t('capabilities.operations.title')} note={t('capabilities.operations.note')}>
      <CapabilityTable
        rows={operations}
        rowKey={(row) => row.key}
        empty={t('capabilities.operations.empty')}
        columns={[
          { header: t('capabilities.operations.key'), cell: (row) => <CopyValue value={row.key} label={row.key} /> },
          { header: t('capabilities.operations.method'), cell: (row) => <code>{row.method}</code> },
          { header: t('capabilities.operations.path'), cell: (row) => <CopyValue value={row.path} label={row.path} /> },
          {
            header: t('capabilities.operations.policy'),
            cell: (row) => (
              <Badge tone={row.openPolicy === 'default' ? 'success' : 'warning'}>
                {row.openPolicy === 'default' ? t('capabilities.operations.policyDefault') : t('capabilities.operations.policyTargeted')}
              </Badge>
            ),
          },
        ]}
      />
    </CapabilitySection>
  );
}
