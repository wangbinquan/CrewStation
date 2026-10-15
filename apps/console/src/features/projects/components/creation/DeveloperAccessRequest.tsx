import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DeveloperAccessRequestDtoSchema, MyDeveloperAccessSchema } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Card } from '../../../../shared/ui/Card';
import { FormField } from '../../../../shared/ui/FormField';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';

export function DeveloperAccessRequest({ userId, open, onClose }: { readonly userId: string; readonly open: boolean; readonly onClose: () => void }) {
  const t = useT(), client = useQueryClient(), [reason, setReason] = useState(''), key = ['my-developer-access', userId];
  const query = useApiQuery(key, async () => MyDeveloperAccessSchema.parse(await api.users.myDeveloperAccess()), { refetchIntervalMs: 10_000 });
  const request = query.data?.request;
  const mutation = useApiMutation(async () => DeveloperAccessRequestDtoSchema.parse(await api.users.requestDeveloperAccess({ reason })), { invalidate: [key], onSuccess: () => { setReason(''); onClose(); } });
  useEffect(() => { if (request?.state === 'approved') void client.invalidateQueries({ queryKey: queryKeys.me() }); }, [request?.state, client]);
  return <>
    <Card compact stacked title={t('projects.developer.title')}>
      <p>{t('projects.developer.hint')}</p><QueryStatus isPending={query.isPending} error={query.error} />
      {request && !query.error ? <p>{t(`projects.developer.state.${request.state}`)}{request.note ? ` · ${request.note}` : ''}</p> : null}
    </Card>
    {open ? <FormDialog title={t('projects.developer.title')} submitLabel={t('projects.developer.submit')} busy={mutation.isPending} dirty={!!reason} onClear={() => setReason('')}
      submitDisabled={query.isPending || !!query.error || request?.state === 'pending' || !reason.trim()} error={mutation.error ? errorMessage(mutation.error) : undefined} onClose={onClose} onSubmit={() => mutation.mutate()}>
      <p>{t('projects.developer.hint')}</p>
      {request?.state === 'pending' ? <p>{t('projects.developer.state.pending')}</p> : <FormField label={t('projects.developer.reason')}><textarea maxLength={500} rows={4} value={reason} onChange={event => setReason(event.target.value)} /></FormField>}
    </FormDialog> : null}
  </>;
}
