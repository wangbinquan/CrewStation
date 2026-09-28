import { useState } from 'react';
import type { ObjectBackendDto, ObjectStoragePlanDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { FormField } from '../../../shared/ui/FormField';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { planInput } from '../model/storageDraft';
import type { PlanDraft } from '../model/storageDraft';
import styles from './Storage.module.css';

export function PlanEditor({ original, backends, draft, change, close, saved }: { original?: ObjectStoragePlanDto; backends: ObjectBackendDto[]; draft: PlanDraft; change: (draft: PlanDraft) => void; close: () => void; saved: () => void }) {
  const t = useT(), [error, setError] = useState<string>();
  const mutation = useApiMutation(() => api.objectStorage.savePlan(planInput(draft), original), { invalidate: [['object-storage']], onSuccess: saved });
  const submit = () => { setError(undefined); try { planInput(draft); mutation.mutate(); } catch { setError(t('objects.invalidForm')); } };
  return <FormDialog title={t(original ? 'objects.editPlan' : 'objects.addPlan')} submitLabel={t('objects.save')} busy={mutation.isPending}
    error={error ?? (mutation.error ? errorMessage(mutation.error) : undefined)} onSubmit={submit} onClose={close}>
    <div className={styles.formGrid}>{(['name', 'quotaGiB', 'objectMiB', 'transfers'] as const).map((key) => <FormField key={key} label={t(`objects.${key}`)}>
      <input value={draft[key]} disabled={mutation.isPending} inputMode={key === 'name' ? 'text' : 'decimal'} onChange={(e) => change({ ...draft, [key]: e.target.value })} />
    </FormField>)}<FormField label={t('objects.backend')}><select disabled={!!original || mutation.isPending} value={draft.backendId} onChange={(e) => change({ ...draft, backendId: e.target.value })}>
      <option value="">{t('objects.chooseBackend')}</option>{backends.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select></FormField><FormField label={t('objects.enabled')}><input type="checkbox" checked={draft.enabled} disabled={mutation.isPending} onChange={(e) => change({ ...draft, enabled: e.target.checked })} /></FormField></div>
    <p className={styles.muted}>{t('objects.planHint')}</p>
  </FormDialog>;
}
