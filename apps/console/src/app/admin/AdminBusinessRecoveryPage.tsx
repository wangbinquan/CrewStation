import { useState } from 'react';
import type { LegacyRecoveryItem } from '@crewstation/api-client';
import { api } from '../../shared/api/client';
import { AUTO_REFRESH, errorMessage, useApiMutation, useApiQuery } from '../../shared/api/useApi';
import { useT } from '../../shared/lib/useT';
import { PageHeader } from '../../shared/ui/PageHeader';
import { Card } from '../../shared/ui/Card';
import { Stack } from '../../shared/ui/Stack';
import { ActionRow } from '../../shared/ui/ActionRow';
import { ActionNote } from '../../shared/ui/ActionNote';
import { Button } from '../../shared/ui/Button';
import { DataTable } from '../../shared/ui/DataTable';
import { FormField } from '../../shared/ui/FormField';
import { ConfirmationDialog } from '../../shared/ui/dialog/ConfirmationDialog';

export function AdminBusinessRecoveryPage() {
  const t = useT(), [draft, setDraft] = useState(''), [identity, setIdentity] = useState('');
  return <Stack>
    <PageHeader title={t('executionRecovery.title')} description={t('executionRecovery.hint')} />
    <Card><form onSubmit={(event) => { event.preventDefault(); if (draft.trim()) setIdentity(draft.trim()); }}><Stack>
      <FormField label={t('executionRecovery.identity')}><input required value={draft} maxLength={256} onChange={(event) => setDraft(event.target.value)} placeholder="project/service" /></FormField>
      <ActionRow><Button type="submit" variant="primary" disabled={!draft.trim()}>{t('executionRecovery.inspect')}</Button></ActionRow>
    </Stack></form></Card>
    {identity ? <RecoveryTickets key={identity} identity={identity} /> : null}
  </Stack>;
}
function RecoveryTickets({ identity }: { readonly identity: string }) {
  const t = useT(), [selected, setSelected] = useState<LegacyRecoveryItem>();
  const key = ['legacy-execution-recovery', identity], query = useApiQuery(key, () => api.tasks.legacyRecovery(identity), AUTO_REFRESH);
  const action = useApiMutation((input: { action: 'stop' | 'reconcile'; ticketId?: string }) => api.tasks.recoverLegacy(identity, input.action, input.ticketId), { invalidate: [key], onSuccess: () => setSelected(undefined) });
  const submit = (kind: 'stop' | 'reconcile', ticketId?: string) => { action.mutate({ action: kind, ticketId }); };
  const current = query.data?.items.find((item) => item.id === selected?.id);
  return <Card title={identity} stacked actions={<Button disabled={action.isPending || !query.data || !!query.error} onClick={() => submit('reconcile')}>{t('executionRecovery.reconcile')}</Button>}>
    {query.isPending ? <p>{t('executionRecovery.loading')}</p> : null}
    {query.error ? <ActionNote tone="error">{errorMessage(query.error)}</ActionNote> : null}
    {action.error ? <ActionNote tone="error">{errorMessage(action.error)}</ActionNote> : null}
    {action.data ? <ActionNote tone="success">{t('executionRecovery.result', { count: action.data.recovered })}</ActionNote> : null}
    {query.data?.items.length === 0 && !query.error ? <p>{t('executionRecovery.empty')}</p> : null}
    {query.data?.items.length ? <DataTable columns={[t('executionRecovery.ticket'), t('executionRecovery.reason'), t('executionRecovery.actions')]}>
      {query.data.items.map((item) => <tr key={item.id}><td><div>{item.id}</div><div>{item.taskId}</div><div>{item.kind}</div></td>
        <td>{item.blockedBy.length ? item.blockedBy.map((reason) => <p key={reason}>{t(`executionRecovery.${reason}`)}</p>) : t('executionRecovery.ready')}</td>
        <td><Button size="small" variant="danger" disabled={!item.canStopRuntime || action.isPending || !!query.error} onClick={() => { action.reset(); setSelected(item); }}>{t('executionRecovery.stop')}</Button></td></tr>)}
    </DataTable> : null}
    {selected ? <ConfirmationDialog title={t('executionRecovery.stop')} question={t('executionRecovery.stopQuestion', { identity, ticket: selected.id })} hint={t('executionRecovery.consequence')}
      danger busy={action.isPending} confirmDisabled={!current?.canStopRuntime || !!query.error} confirmLabel={t('executionRecovery.confirm')} onConfirm={() => submit('stop', selected.id)} onCancel={() => setSelected(undefined)}>
      {action.error ? <ActionNote tone="error">{errorMessage(action.error)}</ActionNote> : null}
    </ConfirmationDialog> : null}
  </Card>;
}
