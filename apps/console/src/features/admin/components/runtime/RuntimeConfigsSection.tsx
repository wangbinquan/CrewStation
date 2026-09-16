import type { CreateRuntimeConfigInput } from '@crewstation/api-client';
import type { RuntimeConfigPreset, RuntimeDriver } from '@crewstation/contracts';
import { SlugSchema } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { DataTable } from '../../../../shared/ui/DataTable';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { RUNTIME_DRIVERS } from '../../model/computeDrivers';
import { AdminField } from '../AdminField';
import { AdminForm } from '../AdminForm';
import { RuntimeStatusBadge } from './RuntimeStatusBadge';

const PRESETS: Readonly<Record<RuntimeDriver, readonly RuntimeConfigPreset[]>> = { 'claude-code': ['claude-settings', 'blank'], opencode: ['opencode-config', 'blank'] };

/** 运行环境列表与建档（RFC-004）：建档只产生草稿，随后进入编辑页写步骤、检查、启用。 */
export function RuntimeConfigsSection({ onOpen }: { readonly onOpen: (configId: string) => void }): ReactElement {
  const t = useT();
  const list = useApiQuery(queryKeys.runtimeConfigs(), () => api.agentRuntime.listConfigs({ limit: 50 }));
  const create = useApiMutation((input: CreateRuntimeConfigInput) => api.agentRuntime.createConfig(input), { invalidate: [queryKeys.runtimeConfigs()], onSuccess: (detail) => onOpen(detail.id) });
  const [name, setName] = useState('');
  const [driver, setDriver] = useState<RuntimeDriver>('claude-code');
  const [preset, setPreset] = useState<RuntimeConfigPreset>('claude-settings');
  const [description, setDescription] = useState('');
  const items = list.data?.items ?? [];
  const columns = ['name', 'driver', 'status', 'activeRevision', 'draftRevision', 'references', 'updated', 'actions'].map((column) => t(`admin.runtime.${column}`));
  return (
    <Card title={t('admin.runtime.title')} footer={t('admin.runtime.hint')}>
      <QueryStatus isPending={list.isPending} error={list.error} isEmpty={items.length === 0} emptyTitle={t('admin.runtime.emptyTitle')} emptyDescription={t('admin.runtime.emptyDescription')} />
      {items.length > 0 ? (
        <DataTable columns={columns}>
          {items.map((config) => (
            <tr key={config.id}>
              <td><code>{config.name}</code></td>
              <td>{config.driver}</td>
              <td><RuntimeStatusBadge status={config.status} /></td>
              <td>{config.activeRevision === null ? t('admin.runtime.none') : config.activeRevision}</td>
              <td>{config.draftRevision}</td>
              <td>{config.referencedProfiles}</td>
              <td>{new Date(config.updatedAt).toLocaleString()}</td>
              <td><Button onClick={() => onOpen(config.id)}>{t('admin.runtime.open')}</Button></td>
            </tr>
          ))}
        </DataTable>
      ) : null}
      <AdminForm
        submitLabel={t('admin.runtime.create')} busyLabel={t('admin.runtime.creating')} busy={create.isPending}
        incomplete={!SlugSchema.safeParse(name).success} note={t('admin.runtime.presetHint')}
        error={create.error === null ? undefined : t('admin.runtime.createError', { message: errorMessage(create.error) })}
        onSubmit={() => create.mutate({ name, driver, preset, ...(description === '' ? {} : { description }) })}
      >
        <AdminField label={t('admin.runtime.name')} value={name} onChange={setName} placeholder={t('admin.runtime.namePlaceholder')} />
        <AdminField label={t('admin.runtime.driver')} value={driver} options={RUNTIME_DRIVERS.map((option) => ({ value: option, label: option }))}
          onChange={(value) => { const next = value as RuntimeDriver; setDriver(next); setPreset(PRESETS[next][0]!); }} />
        <AdminField label={t('admin.runtime.preset')} value={preset} onChange={(value) => setPreset(value as RuntimeConfigPreset)}
          options={PRESETS[driver].map((option) => ({ value: option, label: t(`admin.runtime.preset.${option}`) }))} />
        <AdminField label={t('admin.runtime.description')} value={description} onChange={setDescription} />
      </AdminForm>
    </Card>
  );
}
