import type { BusinessExecutionTaskItem, BusinessExecutionTaskQuery } from '@crewstation/contracts';
import { TaskRecoveryPanel } from '../../features/business-recovery/components/TaskRecoveryPanel';
import { TaskStorageStatus } from '../../features/object-storage';
import { QueryStatus } from '../../shared/ui/QueryStatus';
import { useAdminPage } from '../../shared/admin/useAdminRead';
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
import { Dialog } from '../../shared/ui/dialog/Dialog';

export function AdminBusinessRecoveryPage() {
  const t = useT(), [projectId, setProjectId] = useState(''), [cursor, setCursor] = useState<string>(), [selected, setSelected] = useState<BusinessExecutionTaskItem>();
  const [state, setState] = useState<BusinessExecutionTaskQuery['state']>();
  const { query, me, allowed } = useAdminPage(['business-execution-tasks', projectId, state, cursor], () => api.tasks.listExecutionTasks({ projectId: projectId || undefined, state, cursor, limit: 30 }), true, true);
  const projects = useApiQuery(['business-execution-projects'], () => api.projects.list(), { ...AUTO_REFRESH, enabled: allowed });
  const projectName = (id: string) => projects.data?.items.find((p) => p.id === id)?.name ?? t('executionRecovery.projectNumber', { id: id.slice(-12) });
  const taskName = (item: BusinessExecutionTaskItem) => item.labels.name || item.labels.title || t('executionRecovery.taskNumber', { id: item.id.slice(-12) });
  const current = query.data?.items.find((item) => item.id === selected?.id && item.protocol === selected.protocol) ?? selected;
  return <Stack>
    <PageHeader title={t('executionRecovery.title')} description={t('executionRecovery.hint')} />
    <QueryStatus isPending={me.isPending} error={me.error} />
    {allowed ? <>
      <Card title={t('executionRecovery.tasks')}><Stack>
        <FormField label={t('executionRecovery.project')}><select value={projectId} onChange={(e) => { setProjectId(e.target.value); setCursor(undefined); setSelected(undefined); }}>
          <option value="">{t('executionRecovery.allProjects')}</option>{projects.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></FormField><FormField label={t('recovery.filter')}><select value={state ?? ''} onChange={(e) => { setState((e.target.value || undefined) as BusinessExecutionTaskQuery['state']); setCursor(undefined); setSelected(undefined); }}>
          <option value="">{t('recovery.allStates')}</option>{(['failed', 'unknown', 'paused', 'running', 'closed'] as const).map((value) => <option key={value} value={value}>{t(`recovery.filter.${value}`)}</option>)}
        </select></FormField><QueryStatus isPending={projects.isPending} error={projects.error} />
        <QueryStatus isPending={query.isPending} error={query.error} isEmpty={query.data?.items.length === 0} emptyTitle={t('executionRecovery.noTasks')} />
        {query.data?.items.length ? <DataTable columns={[t('executionRecovery.task'), t('executionRecovery.project'), t('executionRecovery.state'), t('executionRecovery.reason'), t('executionRecovery.updated'), t('executionRecovery.actions')]}>
          {query.data.items.map((item) => <tr key={`${item.protocol}:${item.id}`}><td>{taskName(item)}</td><td>{projectName(item.projectId)}</td><td>{t(`executionRecovery.state.${item.state}`)}{item.attention !== 'none' ? <p>{t(`executionRecovery.attention.${item.attention}`)}</p> : null}</td>
            <td>{item.latestFailure?.message || item.message || '—'}{item.failedSubtasks ? <p>{t('executionRecovery.failedChildren', { count: item.failedSubtasks })}</p> : null}</td><td>{new Date(item.updatedAt).toLocaleString()}</td><td><Button size="small" onClick={() => setSelected(item)}>{t('executionRecovery.openTask')}</Button></td></tr>)}
        </DataTable> : null}
        <ActionRow>{cursor ? <Button onClick={() => { setCursor(undefined); setSelected(undefined); }}>{t('executionRecovery.first')}</Button> : null}{query.data?.next ? <Button onClick={() => { setCursor(query.data!.next); setSelected(undefined); }}>{t('executionRecovery.next')}</Button> : null}</ActionRow>
      </Stack></Card>
      {current ? <Dialog title={`${projectName(current.projectId)} · ${taskName(current)}`} size="large" initialFocus="dialog" onClose={() => setSelected(undefined)}
        footer={<ActionRow><Button variant="ghost" onClick={() => setSelected(undefined)}>{t('ui.dialog.close')}</Button></ActionRow>}><Stack>
        {current.protocol === 'v3' ? <TaskRecoveryPanel key={current.id} taskId={current.id} name={taskName(current)} onOpenTask={(id) => setSelected({ ...current, id, state: 'unknown', message: undefined, latestFailure: undefined, labels: {} })} /> : <>
          <p>{t('executionRecovery.state')}：{t(`executionRecovery.state.${current.state}`)} · {t('executionRecovery.updated')}：{new Date(current.updatedAt).toLocaleString()}</p>
          <p>{current.message || current.latestFailure?.message}</p>
          {current.latestFailure ? <p>{current.latestFailure.name} · {current.latestFailure.state}</p> : null}
          <ActionNote tone="neutral">{t('recovery.legacyHint')}</ActionNote>
        </>}
        <details><summary>{t('executionRecovery.identityDetails')}</summary><p>{current.id}</p><p>{current.callerIdentity}</p><p>{current.protocol}</p></details>
        {current.protocol === 'v3' ? <TaskStorageStatus key={`storage:${current.id}`} taskId={current.id} /> : null}
        {current.protocol === 'legacy' ? <RecoveryTickets key={`${current.callerIdentity}:${current.id}`} identity={current.callerIdentity} taskId={current.id} /> : null}
      </Stack></Dialog> : null}
    </> : !me.isPending && !me.error ? <p>{t('admin.denied.title')}</p> : null}
  </Stack>;
}
function RecoveryTickets({ identity, taskId }: { readonly identity: string; readonly taskId: string }) {
  const t = useT(), [selected, setSelected] = useState<LegacyRecoveryItem>();
  const key = ['legacy-execution-recovery', identity], query = useApiQuery(key, () => api.tasks.legacyRecovery(identity), AUTO_REFRESH);
  const action = useApiMutation((input: { action: 'stop' | 'reconcile'; ticketId?: string }) => api.tasks.recoverLegacy(identity, input.action, input.ticketId), { invalidate: [key], onSuccess: () => setSelected(undefined) });
  const submit = (kind: 'stop' | 'reconcile', ticketId?: string) => { action.mutate({ action: kind, ticketId }); };
  const items = query.data?.items.filter((item) => item.taskId === taskId);
  const current = items?.find((item) => item.id === selected?.id);
  return <Card title={t('executionRecovery.legacyDiagnostics')} stacked actions={<Button disabled={action.isPending || !query.data || !!query.error} onClick={() => submit('reconcile')}>{t('executionRecovery.reconcile')}</Button>}>
    {query.isPending ? <p>{t('executionRecovery.loading')}</p> : null}
    {query.error ? <ActionNote tone="error">{errorMessage(query.error)}</ActionNote> : null}
    {action.error ? <ActionNote tone="error">{errorMessage(action.error)}</ActionNote> : null}
    {action.data ? <ActionNote tone="success">{t('executionRecovery.result', { count: action.data.recovered })}</ActionNote> : null}
    {items?.length === 0 && !query.error ? <p>{t('executionRecovery.empty')}</p> : null}
    {items?.length ? <DataTable columns={[t('executionRecovery.ticket'), t('executionRecovery.reason'), t('executionRecovery.actions')]}>
      {items!.map((item) => <tr key={item.id}><td><div>{item.id}</div><div>{item.taskId}</div><div>{item.kind}</div></td>
        <td>{item.blockedBy.length ? item.blockedBy.map((reason) => <p key={reason}>{t(`executionRecovery.${reason}`)}</p>) : t('executionRecovery.ready')}</td>
        <td><Button size="small" variant="danger" disabled={!item.canStopRuntime || action.isPending || !!query.error} onClick={() => { action.reset(); setSelected(item); }}>{t('executionRecovery.stop')}</Button></td></tr>)}
    </DataTable> : null}
    {selected ? <ConfirmationDialog title={t('executionRecovery.stop')} question={t('executionRecovery.stopQuestion', { identity, ticket: selected.id })} hint={t('executionRecovery.consequence')}
      danger busy={action.isPending} confirmDisabled={!current?.canStopRuntime || !!query.error} confirmLabel={t('executionRecovery.confirm')} onConfirm={() => submit('stop', selected.id)} onCancel={() => setSelected(undefined)}>
      {action.error ? <ActionNote tone="error">{errorMessage(action.error)}</ActionNote> : null}
    </ConfirmationDialog> : null}
  </Card>;
}
