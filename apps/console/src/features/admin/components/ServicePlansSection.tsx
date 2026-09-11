import type { ServicePlanInput } from '@crewstation/api-client';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ServicePlanForm } from './ServicePlanForm';

/** 服务套餐目录：Manifest 按名字引用，管理员在这里新增或覆盖。 */
export function ServicePlansSection(): ReactElement {
  const t = useT();
  const plans = useApiQuery(queryKeys.servicePlans(), () => api.catalog.listServicePlans());
  const upsert = useApiMutation((input: ServicePlanInput) => api.catalog.upsertServicePlan(input), { invalidate: [queryKeys.servicePlans()] });
  const items = plans.data?.items ?? [];
  return (
    <Card title={t('admin.plans.title')} footer={t('admin.plans.hint')}>
      <QueryStatus
        isPending={plans.isPending}
        error={plans.error}
        isEmpty={items.length === 0}
        emptyTitle={t('admin.plans.emptyTitle')}
        emptyDescription={t('admin.plans.emptyDescription')}
      />
      {items.length > 0 ? (
        <DataTable columns={[t('admin.plans.name'), t('admin.plans.cpu'), t('admin.plans.memory'), t('admin.plans.maxReplicas'), t('admin.plans.description')]}>
          {items.map((plan) => (
            <tr key={plan.name}>
              <td>
                <code>{plan.name}</code>
              </td>
              <td>{plan.cpu}</td>
              <td>{plan.memory}</td>
              <td>{plan.maxReplicas}</td>
              <td>{plan.description === '' ? t('admin.none') : plan.description}</td>
            </tr>
          ))}
        </DataTable>
      ) : null}
      <ServicePlanForm
        busy={upsert.isPending}
        error={upsert.error === null ? undefined : t('admin.plans.saveError', { message: errorMessage(upsert.error) })}
        onSubmit={(input) => upsert.mutate(input)}
      />
    </Card>
  );
}
