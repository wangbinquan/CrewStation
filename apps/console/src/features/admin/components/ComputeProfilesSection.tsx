import type { ComputeProfileInput } from '@crewstation/api-client';
import type { ComputeProfileAdminDto } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { InlineConfirm } from '../../../shared/ui/InlineConfirm';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ComputeProfileForm } from './ComputeProfileForm';
import { MutationError } from './MutationError';

/**
 * 算力档位（RFC-001）：业务只引用档位名，厂商、模型与驱动的映射只在这里维护。
 * 用带 full=true 的管理面投影，否则表里看不到 driver、model 与运行环境就绪情况（RFC-004）。
 */
export function ComputeProfilesSection({ onOpenRuntime }: { readonly onOpenRuntime?: (configId: string) => void }): ReactElement {
  const t = useT();
  const invalidate = [queryKeys.computeProfiles(), queryKeys.runtimeConfigs()];
  const profiles = useApiQuery(queryKeys.computeProfilesFull(), () => api.catalog.listComputeProfilesFull());
  const tasks = useApiQuery(queryKeys.taskProfiles(), () => api.catalog.listTaskProfiles());
  const runtimes = useApiQuery(queryKeys.runtimeConfigs(), () => api.agentRuntime.listConfigs({ limit: 50 }));
  const [editing, setEditing] = useState<ComputeProfileAdminDto | undefined>(undefined);
  const upsert = useApiMutation((input: ComputeProfileInput) => api.catalog.upsertComputeProfile(input), { invalidate, onSuccess: () => setEditing(undefined) });
  const remove = useApiMutation((name: string) => api.catalog.deleteComputeProfile(name), { invalidate });
  const items = profiles.data?.items ?? [];
  const columns = ['name', 'driver', 'model', 'runtimeConfig', 'taskProfile', 'description', 'actions'].map((column) => t(`admin.compute.${column}`));
  return (
    <Card title={t('admin.compute.title')} footer={t('admin.compute.hint')}>
      <MutationError error={remove.error} messageKey="admin.compute.removeError" />
      <QueryStatus isPending={profiles.isPending} error={profiles.error} isEmpty={items.length === 0} emptyTitle={t('admin.compute.emptyTitle')} emptyDescription={t('admin.compute.emptyDescription')} />
      {items.length > 0 ? (
        <DataTable columns={columns}>
          {items.map((profile) => (
            <tr key={profile.name}>
              <td><code>{profile.name}</code></td>
              <td>{profile.driver}</td>
              <td><code>{profile.model}</code></td>
              <td><RuntimeCell profile={profile} onOpenRuntime={onOpenRuntime} /></td>
              <td>{profile.taskProfile ?? t('admin.compute.defaultTaskProfile')}</td>
              <td>{profile.description === '' ? t('admin.none') : profile.description}</td>
              <td>
                <Button disabled={upsert.isPending} onClick={() => setEditing(profile)}>{t('admin.compute.edit')}</Button>{' '}
                <InlineConfirm label={t('admin.compute.remove')} question={t('admin.compute.removeQuestion')} busy={remove.isPending && remove.variables === profile.name} busyLabel={t('admin.compute.removing')} onConfirm={() => remove.mutate(profile.name)} />
              </td>
            </tr>
          ))}
        </DataTable>
      ) : null}
      {editing ? (
        <ActionNote tone="neutral">
          {t('admin.compute.editing', { name: editing.name, revision: editing.revision })}{' '}
          <Button disabled={upsert.isPending} onClick={() => setEditing(undefined)}>{t('admin.compute.cancelEdit')}</Button>
        </ActionNote>
      ) : null}
      <ComputeProfileForm
        key={editing?.name ?? ''} editing={editing}
        taskProfiles={tasks.data?.items ?? []} profilesUnavailable={!tasks.data || !!tasks.error}
        runtimeConfigs={runtimes.data?.items ?? []} runtimeUnavailable={runtimes.isError}
        busy={upsert.isPending}
        error={upsert.error === null ? undefined : t('admin.compute.saveError', { message: errorMessage(upsert.error) })}
        onSubmit={(input) => upsert.mutate(input)}
      />
    </Card>
  );
}

function RuntimeCell({ profile, onOpenRuntime }: { readonly profile: ComputeProfileAdminDto; readonly onOpenRuntime?: (configId: string) => void }): ReactElement {
  const t = useT();
  if (profile.runtimeConfigId === undefined) return <>{t('admin.compute.runtimeLegacy')}</>;
  const runtime = profile.runtime;
  if (!runtime) return <Badge tone="danger">{t('admin.compute.runtimeMissing')}</Badge>;
  return (
    <>
      {onOpenRuntime ? <Button variant="ghost" onClick={() => onOpenRuntime(profile.runtimeConfigId!)}><code>{runtime.configName}</code></Button> : <code>{runtime.configName}</code>}{' '}
      <Badge tone={runtime.ready ? 'success' : 'danger'}>{runtime.ready ? t('admin.compute.runtimeReady') : t('admin.compute.runtimeNotReady', { reason: runtime.reason ?? '' })}</Badge>
      {runtime.activeRevision !== null ? <small> · {t('admin.compute.revision')} {runtime.activeRevision}</small> : null}
    </>
  );
}
