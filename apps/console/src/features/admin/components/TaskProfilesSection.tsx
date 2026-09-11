import type { TaskProfileInput } from '@crewstation/api-client';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { AdminTable } from './AdminTable';
import { SectionStatus } from './SectionStatus';
import { TaskProfileForm } from './TaskProfileForm';

/** 任务容器 profile：开发会话与业务任务容器的规格来源。 */
export function TaskProfilesSection(): ReactElement {
  const t = useT();
  const profiles = useApiQuery(queryKeys.taskProfiles(), () => api.catalog.listTaskProfiles());
  const upsert = useApiMutation((input: TaskProfileInput) => api.catalog.upsertTaskProfile(input), { invalidate: [queryKeys.taskProfiles()] });
  const items = profiles.data?.items ?? [];
  return (
    <Card title={t('admin.profiles.title')} footer={t('admin.profiles.hint')}>
      <SectionStatus
        isPending={profiles.isPending}
        error={profiles.error}
        isEmpty={items.length === 0}
        emptyTitle={t('admin.profiles.emptyTitle')}
        emptyDescription={t('admin.profiles.emptyDescription')}
      />
      {items.length > 0 ? (
        <AdminTable
          columns={[t('admin.profiles.name'), t('admin.profiles.cpu'), t('admin.profiles.memory'), t('admin.profiles.storage'), t('admin.profiles.description')]}
        >
          {items.map((profile) => (
            <tr key={profile.name}>
              <td>
                <code>{profile.name}</code>
              </td>
              <td>{profile.cpu}</td>
              <td>{profile.memory}</td>
              <td>{profile.storage}</td>
              <td>{profile.description === '' ? t('admin.none') : profile.description}</td>
            </tr>
          ))}
        </AdminTable>
      ) : null}
      <TaskProfileForm
        busy={upsert.isPending}
        error={upsert.error === null ? undefined : t('admin.profiles.saveError', { message: errorMessage(upsert.error) })}
        onSubmit={(input) => upsert.mutate(input)}
      />
    </Card>
  );
}
