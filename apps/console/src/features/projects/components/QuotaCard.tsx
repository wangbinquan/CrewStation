import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { DefinitionList } from './DefinitionList';
import { QueryStatus } from './QueryStatus';

/** 唯一的预算是每个数字人的并发任务配额；超出一律拒绝，不排队。 */
export function QuotaCard({ projectId }: { readonly projectId: string }): ReactElement {
  const t = useT();
  const quota = useApiQuery(queryKeys.quota(projectId), () => api.projects.getQuota(projectId));
  return (
    <Card title={t('projects.quota.title')}>
      <QueryStatus isPending={quota.isPending} error={quota.error} loadingKey="projects.quota.loading" errorKey="projects.quota.error" />
      {quota.data !== undefined ? (
        <DefinitionList
          facts={[
            { label: t('projects.quota.running'), value: quota.data.running },
            { label: t('projects.quota.max'), value: quota.data.maxConcurrentTasks },
          ]}
        />
      ) : null}
    </Card>
  );
}
