import { TraceIdSchema } from '@crewstation/contracts';
import { useId, useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { useApiQuery } from '../../../shared/api/useApi';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Stack } from '../../../shared/ui/Stack';

export function TracePage({ projectId, traceId, onTrace }: { readonly projectId: string; readonly traceId?: string; readonly onTrace: (id: string) => void }) {
  const t = useT(), dateText = useDateText(), [draft, setDraft] = useState(traceId ?? ''), [invalid, setInvalid] = useState(false);
  const fieldId = useId(), field = useRef<HTMLInputElement>(null);
  const trace = useApiQuery(['trace', projectId, traceId], () => api.observability.trace(projectId, traceId!), { enabled: Boolean(traceId) });
  return <Card stacked compact title={t('operations.tab.trace')}>
    <form onSubmit={(event) => { event.preventDefault(); const result = TraceIdSchema.safeParse(draft.trim()); setInvalid(!result.success); if (result.success) onTrace(result.data); else field.current?.focus(); }}><Stack>
      <FormField label="Trace ID" hint={t('logs.trace.hint')} hintId={`${fieldId}-hint`} errorId={`${fieldId}-error`} error={invalid ? t('logs.trace.invalid') : undefined}><input ref={field} aria-describedby={`${fieldId}-hint`} aria-errormessage={invalid ? `${fieldId}-error` : undefined} aria-invalid={invalid} value={draft} onChange={(event) => setDraft(event.target.value)} /></FormField>
      <Button type="submit" variant="primary">{t('logs.trace.load')}</Button>
    </Stack></form>
    {traceId ? <QueryStatus isPending={trace.isPending} error={trace.error} isEmpty={trace.data?.events.length === 0 && trace.data.tasks.length === 0 && trace.data.subtasks.length === 0 && trace.data.sessionIds.length === 0} emptyTitle={t('logs.trace.empty')} /> : null}
    {trace.data ? <>
      <p><code>{trace.data.traceId}</code></p>
      <DataTable columns={[t('logs.trace.time'), t('logs.trace.type'), t('logs.trace.detail')]}>
        {trace.data.tasks.map((task) => <tr key={task.taskId}><td>{dateText(task.createdAt)}</td><td>{task.kind}</td><td><code>{task.taskId}</code></td></tr>)}
        {trace.data.subtasks.map((subtask) => <tr key={subtask.subtaskId}><td>—</td><td>{subtask.name} · {subtask.state}</td><td><code>{subtask.subtaskId}</code> · <code>{subtask.taskId}</code></td></tr>)}
        {trace.data.events.map((event, i) => <tr key={`${event.at}:${i}`}><td>{dateText(event.at)}</td><td>{event.type}</td><td>{event.summary}<br /><code>{event.taskId ?? event.subtaskId ?? event.sessionId}</code></td></tr>)}
      </DataTable>
      {trace.data.sessionIds.length ? <details><summary>{t('logs.trace.sessions')}</summary>{trace.data.sessionIds.map((id) => <p key={id}><code>{id}</code></p>)}</details> : null}
    </> : null}
  </Card>;
}
