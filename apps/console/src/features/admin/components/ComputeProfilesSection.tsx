import type { ComputeProfileInput } from '@crewstation/api-client';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { InlineConfirm } from '../../../shared/ui/InlineConfirm';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ComputeProfileForm } from './ComputeProfileForm';
import { MutationError } from './MutationError';

/**
 * 算力档位（RFC-001）：业务只引用档位名，厂商、模型与驱动的映射只在这里维护。
 * 用带 full=true 的管理面投影，否则表里看不到 driver 与 model。
 */
export function ComputeProfilesSection(): ReactElement {
  const t = useT();
  const invalidate = [queryKeys.computeProfiles()];
  const profiles = useApiQuery(queryKeys.computeProfilesFull(), () => api.catalog.listComputeProfilesFull());
  const upsert = useApiMutation((input: ComputeProfileInput) => api.catalog.upsertComputeProfile(input), { invalidate });
  const remove = useApiMutation((name: string) => api.catalog.deleteComputeProfile(name), { invalidate });
  const items = profiles.data?.items ?? [];
  const columns = [t('admin.compute.name'), t('admin.compute.driver'), t('admin.compute.model'), t('admin.compute.description'), t('admin.compute.actions')];
  return (
    <Card title={t('admin.compute.title')} footer={t('admin.compute.hint')}>
      <MutationError error={remove.error} messageKey="admin.compute.removeError" />
      <QueryStatus
        isPending={profiles.isPending}
        error={profiles.error}
        isEmpty={items.length === 0}
        emptyTitle={t('admin.compute.emptyTitle')}
        emptyDescription={t('admin.compute.emptyDescription')}
      />
      {items.length > 0 ? (
        <DataTable columns={columns}>
          {items.map((profile) => (
            <tr key={profile.name}>
              <td>
                <code>{profile.name}</code>
              </td>
              <td>{profile.driver}</td>
              <td>
                <code>{profile.model}</code>
              </td>
              <td>{profile.description === '' ? t('admin.none') : profile.description}</td>
              <td>
                <InlineConfirm
                  label={t('admin.compute.remove')}
                  question={t('admin.compute.removeQuestion')}
                  busy={remove.isPending && remove.variables === profile.name}
                  busyLabel={t('admin.compute.removing')}
                  onConfirm={() => remove.mutate(profile.name)}
                />
              </td>
            </tr>
          ))}
        </DataTable>
      ) : null}
      <ComputeProfileForm
        busy={upsert.isPending}
        error={upsert.error === null ? undefined : t('admin.compute.saveError', { message: errorMessage(upsert.error) })}
        onSubmit={(input) => upsert.mutate(input)}
      />
    </Card>
  );
}
