import type { BusinessRecoveryRequest, TaskId } from '@crewstation/contracts';
import { useT, type Translate } from '../../../shared/lib/useT';
import { Stack } from '../../../shared/ui/Stack';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';

export function RecoveryHistory({ records, onOpenTask }: { readonly records: BusinessRecoveryRequest[]; readonly onOpenTask: (id: TaskId) => void }) {
  const t = useT();
  return <Stack><h3>{t('recovery.history')}</h3><p>{t('recovery.historyHint')}</p>
    {!records.length ? <p>{t('recovery.noRequests')}</p> : <DataTable columns={[t('recovery.action'), t('executionRecovery.state'), t('executionRecovery.updated'), t('recovery.result')]}>
      {records.map((r) => <tr key={r.id}><td>{t(`recovery.action.${r.target.action}`)}</td><td>{t(`recovery.status.${r.state}`)}</td><td>{new Date(r.updatedAt).toLocaleString()}</td><td>
        {r.reason ? <><p>{failureReason(t, r.reason)}</p><details><summary>{t('recovery.failureDetails')}</summary>{r.reason}</details></> : null}
        {r.resultTaskId ? <Button size="small" onClick={() => onOpenTask(r.resultTaskId!)}>{t('recovery.newTask')}</Button> : null}
        {r.resultSubtaskId ? <p>{t('recovery.resultAttempt', { id: r.resultSubtaskId.slice(-12) })}</p> : null}
        {['pending', 'claimed', 'running'].includes(r.state) ? <p>{t(`recovery.progress.${r.state}`)}</p> : null}
      </td></tr>)}
    </DataTable>}
  </Stack>;
}

function failureReason(t: Translate, reason: string): string {
  const key = `recovery.reason.${reason}`, translated = t(key);
  if (translated !== key) return translated;
  return /^[a-z_]+$/.test(reason) ? t('recovery.failureUnknown') : t('recovery.failure', { reason });
}
