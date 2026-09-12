import type { ComputeProfileInput } from '@crewstation/api-client';
import type { AgentDriver } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../shared/lib/useT';
import { AdminField } from './AdminField';
import { AdminForm } from './AdminForm';
import { COMPUTE_DRIVERS } from '../model/computeDrivers';

export interface ComputeProfileFormProps {
  readonly onSubmit: (input: ComputeProfileInput) => void;
  readonly busy: boolean;
  readonly error?: ReactNode;
}

/** 新增或覆盖一个算力档位：档位名是业务唯一看得见的部分，driver 与 model 只留在平台侧（RFC-001）。 */
export function ComputeProfileForm({ onSubmit, busy, error }: ComputeProfileFormProps): ReactElement {
  const t = useT();
  const [name, setName] = useState('');
  const [driver, setDriver] = useState<AgentDriver>('claude-code');
  const [model, setModel] = useState('');
  const [description, setDescription] = useState('');
  const incomplete = name === '' || model === '';
  return (
    <AdminForm
      submitLabel={t('admin.compute.submit')}
      busyLabel={t('admin.compute.submitting')}
      busy={busy}
      incomplete={incomplete}
      note={t('admin.compute.note')}
      error={error}
      onSubmit={() => onSubmit({ name, driver, model, description: description === '' ? undefined : description })}
    >
      <AdminField label={t('admin.compute.name')} value={name} onChange={setName} placeholder={t('admin.compute.namePlaceholder')} />
      <AdminField
        label={t('admin.compute.driver')}
        value={driver}
        onChange={(value) => setDriver(value as AgentDriver)}
        options={COMPUTE_DRIVERS.map((option) => ({ value: option, label: option }))}
      />
      <AdminField label={t('admin.compute.model')} value={model} onChange={setModel} placeholder={t('admin.compute.modelPlaceholder')} />
      <AdminField label={t('admin.compute.description')} value={description} onChange={setDescription} placeholder={t('admin.compute.descriptionPlaceholder')} />
    </AdminForm>
  );
}
