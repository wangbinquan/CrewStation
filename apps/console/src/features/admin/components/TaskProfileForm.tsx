import type { TaskProfileInput } from '@crewstation/api-client';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../shared/lib/useT';
import { AdminForm } from './AdminForm';
import { AdminField } from './AdminField';

export interface TaskProfileFormProps {
  readonly onSubmit: (input: TaskProfileInput) => void;
  readonly busy: boolean;
  readonly error?: ReactNode;
}

/** 新增或覆盖一个任务容器 profile；storage 是跟随容器的 PV 大小。 */
export function TaskProfileForm({ onSubmit, busy, error }: TaskProfileFormProps): ReactElement {
  const t = useT();
  const [name, setName] = useState('');
  const [cpu, setCpu] = useState('');
  const [memory, setMemory] = useState('');
  const [storage, setStorage] = useState('');
  const [description, setDescription] = useState('');
  const incomplete = name === '' || cpu === '' || memory === '' || storage === '';
  return (
    <AdminForm
      submitLabel={t('admin.profiles.submit')}
      busyLabel={t('admin.profiles.submitting')}
      busy={busy}
      incomplete={incomplete}
      error={error}
      onSubmit={() => onSubmit({ name, cpu, memory, storage, description: description === '' ? undefined : description })}
    >
      <AdminField label={t('admin.profiles.name')} value={name} onChange={setName} placeholder={t('admin.profiles.namePlaceholder')} />
      <AdminField label={t('admin.profiles.cpu')} value={cpu} onChange={setCpu} placeholder={t('admin.profiles.cpuPlaceholder')} />
      <AdminField label={t('admin.profiles.memory')} value={memory} onChange={setMemory} placeholder={t('admin.profiles.memoryPlaceholder')} />
      <AdminField label={t('admin.profiles.storage')} value={storage} onChange={setStorage} placeholder={t('admin.profiles.storagePlaceholder')} />
      <AdminField label={t('admin.profiles.description')} value={description} onChange={setDescription} />
    </AdminForm>
  );
}
