import { useState } from 'react';
import type { ObjectBackendDto, UpdateObjectBackend } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { FormField } from '../../../shared/ui/FormField';
import { Stack } from '../../../shared/ui/Stack';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { ConfirmationDialog } from '../../../shared/ui/dialog/ConfirmationDialog';
import type { BackendDraft } from '../model/storageDraft';
import { backendRegistration, backendUpdate } from '../model/storageDraft';
import styles from './Storage.module.css';

export function BackendEditor({ original, draft, change, close, saved }: { original?: ObjectBackendDto; draft: BackendDraft; change: (draft: BackendDraft) => void; close: () => void; saved: () => void }) {
  const t = useT(), [error, setError] = useState<string>(), [confirmation, setConfirmation] = useState<UpdateObjectBackend>();
  const mutation = useApiMutation(async (confirmed?: UpdateObjectBackend) => original ? api.objectStorage.updateBackend(original.id, confirmed ?? backendUpdate(draft, original)) : api.objectStorage.registerBackend(backendRegistration(draft)), { invalidate: [['object-storage']], onSuccess: saved });
  const submit = () => {
    setError(undefined);
    try {
      if (original) { const input = backendUpdate(draft, original); if (input.state !== original.state && input.state !== 'active') { setConfirmation(input); return; } }
      else backendRegistration(draft);
      mutation.mutate(undefined);
    } catch { setError(t('objects.invalidForm')); }
  };
  const field = (key: keyof BackendDraft, secret = false) => <FormField key={key} label={t(`objects.${key}`)}>
    <input value={draft[key]} type={secret ? 'password' : 'text'} autoComplete={secret ? 'new-password' : 'off'} disabled={mutation.isPending || !!confirmation} onChange={(e) => change({ ...draft, [key]: e.target.value })} />
  </FormField>;
  return <><FormDialog title={t(original ? 'objects.editBackend' : 'objects.addBackend')} submitLabel={t('objects.save')} busy={mutation.isPending}
    error={error ?? (mutation.error ? errorMessage(mutation.error) : undefined)} onSubmit={submit} onClose={close} size="medium">
    <Stack><div className={styles.formGrid}>{field('name')}{field('budgetGiB')}
      {original ? <FormField label={t('objects.state')}><select value={draft.state} onChange={(e) => change({ ...draft, state: e.target.value })} disabled={mutation.isPending || !!confirmation}>
        {['active', 'no-new-spaces', 'no-new-writes', 'offline'].map((v) => <option key={v} value={v}>{t(`objects.${v}`)}</option>)}
      </select></FormField> : <>
        {field('endpoint')}{field('region')}{field('bucket')}{field('accessKeyId', true)}{field('secretAccessKey', true)}
        {field('monitoringEndpoint')}{field('monitoringToken', true)}
        <FormField label={t('objects.durability')} hint={t('objects.durabilityHint')}><select value={draft.durability} onChange={(e) => change({ ...draft, durability: e.target.value })}>
          {['dev-only', 'replicated'].map((v) => <option key={v} value={v}>{t(`objects.${v}`)}</option>)}
        </select></FormField>
      </>}
    </div><p className={styles.muted}>{t(original ? 'objects.editBackendHint' : 'objects.registerHint')}</p></Stack>
  </FormDialog>{confirmation ? <ConfirmationDialog title={t('objects.changeAvailability')} question={`${original!.name} → ${t(`objects.${confirmation.state}`)}`} hint={t('objects.availabilityHint')}
    confirmLabel={t('objects.save')} busy={mutation.isPending} onCancel={() => setConfirmation(undefined)} onConfirm={() => mutation.mutate(confirmation)}>
    {mutation.error ? <p role="alert">{errorMessage(mutation.error)}</p> : null}
  </ConfirmationDialog> : null}</>;
}
