import type { ServicePlanInput } from '@crewstation/api-client';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../shared/lib/useT';
import { AdminForm } from './AdminForm';
import { AdminField } from './AdminField';

export interface ServicePlanFormProps {
  readonly onSubmit: (input: ServicePlanInput) => void;
  readonly busy: boolean;
  readonly error?: ReactNode;
}

/** 新增或覆盖一个服务套餐；同名即覆盖，所以没有单独的编辑表单。 */
export function ServicePlanForm({ onSubmit, busy, error }: ServicePlanFormProps): ReactElement {
  const t = useT();
  const [name, setName] = useState('');
  const [cpu, setCpu] = useState('');
  const [memory, setMemory] = useState('');
  const [maxReplicas, setMaxReplicas] = useState('1');
  const [description, setDescription] = useState('');
  const replicas = Number(maxReplicas);
  const incomplete = name === '' || cpu === '' || memory === '' || !Number.isInteger(replicas) || replicas < 1;
  return (
    <AdminForm
      submitLabel={t('admin.plans.submit')}
      busyLabel={t('admin.plans.submitting')}
      busy={busy}
      incomplete={incomplete}
      error={error}
      onSubmit={() => onSubmit({ name, cpu, memory, maxReplicas: replicas, description: description === '' ? undefined : description })}
    >
      <AdminField label={t('admin.plans.name')} value={name} onChange={setName} placeholder={t('admin.plans.namePlaceholder')} />
      <AdminField label={t('admin.plans.cpu')} value={cpu} onChange={setCpu} placeholder={t('admin.plans.cpuPlaceholder')} />
      <AdminField label={t('admin.plans.memory')} value={memory} onChange={setMemory} placeholder={t('admin.plans.memoryPlaceholder')} />
      <AdminField label={t('admin.plans.maxReplicas')} value={maxReplicas} onChange={setMaxReplicas} inputMode="numeric" placeholder={t('admin.plans.maxReplicasPlaceholder')} />
      <AdminField label={t('admin.plans.description')} value={description} onChange={setDescription} />
    </AdminForm>
  );
}
