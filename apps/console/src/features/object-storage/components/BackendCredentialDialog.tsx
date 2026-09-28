import { useRef, useState } from 'react';
import type { ObjectBackendDto, RotateObjectBackendCredential } from '@crewstation/contracts';
import { RotateObjectBackendCredentialSchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Stack } from '../../../shared/ui/Stack';
import { FormField } from '../../../shared/ui/FormField';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { ConfirmDialog } from '../../../shared/ui/dialog/ConfirmDialog';

const initial = () => ({ requestKey: crypto.randomUUID(), accessKeyId: '', secretAccessKey: '', monitoringToken: '', reason: '' });
export function BackendCredentialDialog({ backend, open, close, saved }: { backend: ObjectBackendDto; open: boolean; close: () => void; saved: () => void }) {
  const t = useT(), [draft, setDraft] = useState(initial), [error, setError] = useState<string>(), [confirmation, setConfirmation] = useState<RotateObjectBackendCredential>(), sending = useRef(false);
  const mutation = useApiMutation((input: RotateObjectBackendCredential) => api.objectStorage.rotateCredential(backend.id, input), { invalidate: [['object-storage']], onSuccess: () => { setDraft(initial()); setConfirmation(undefined); saved(); } });
  const prepare = () => {
    if (confirmation || mutation.isPending) return;
    const parsed = RotateObjectBackendCredentialSchema.safeParse({ ...draft, monitoringToken: draft.monitoringToken || undefined, expectedRevision: backend.revision, confirmation: 'rotate' });
    if (!parsed.success) { setError(t('objects.rotateRequired')); return; }
    setError(undefined); setConfirmation(parsed.data);
  };
  if (!open) return null;
  return <><FormDialog title={t('objects.rotateTitle')} onClose={close} onSubmit={prepare} submitLabel={t('objects.rotatePreview')} submitDisabled={!!confirmation} busy={mutation.isPending} error={error}
    onClear={() => { setDraft(initial()); setError(undefined); mutation.reset(); }} dirty={!!draft.accessKeyId || !!draft.secretAccessKey || !!draft.reason || !!draft.monitoringToken}>
    <Stack><p>{backend.name}</p><p>{t('objects.rotateHint')}</p>
      {(['accessKeyId', 'secretAccessKey', 'monitoringToken', 'reason'] as const).map((key) => <FormField key={key} label={t(key === 'reason' ? 'objects.rotateReason' : `objects.${key}`)}>
        <input type={key === 'reason' ? 'text' : 'password'} autoComplete="off" value={draft[key]} maxLength={key === 'reason' ? 1024 : key === 'accessKeyId' ? 256 : 4096} disabled={!!confirmation || mutation.isPending}
          onChange={(e) => setDraft((old) => ({ ...old, [key]: e.target.value, requestKey: crypto.randomUUID() }))} />
      </FormField>)}
    </Stack>
  </FormDialog>{confirmation ? <ConfirmDialog title={t('objects.rotateTitle')} question={`${backend.name} · ${t('objects.rotateConsequence')}`} confirmWord="rotate" confirmLabel={t('objects.rotateSubmit')} busy={mutation.isPending}
    onCancel={() => setConfirmation(undefined)} onConfirm={() => { if (sending.current) return; sending.current = true; mutation.mutate(confirmation, { onSettled: () => { sending.current = false; } }); }}>
    <Stack><p>{confirmation.reason}</p><p>{t('objects.rotateLocation', { endpoint: backend.endpoint, bucket: backend.bucket })}</p>
      {mutation.error ? <p role="alert">{errorMessage(mutation.error)}</p> : null}
    </Stack>
  </ConfirmDialog> : null}</>;
}
