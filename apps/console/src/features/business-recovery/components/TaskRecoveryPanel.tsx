import type { BusinessRecoveryAssessment, BusinessRecoveryRequest, RequestBusinessRecovery, TaskId } from '@crewstation/contracts';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Stack } from '../../../shared/ui/Stack';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Button } from '../../../shared/ui/Button';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ConfirmationDialog } from '../../../shared/ui/dialog/ConfirmationDialog';
import { RecoveryHistory } from './RecoveryHistory';

type Option = BusinessRecoveryAssessment['actions'][number];
const active = (r: BusinessRecoveryRequest) => ['pending', 'claimed', 'running'].includes(r.state);
export function TaskRecoveryPanel({ taskId, name, onOpenTask }: { readonly taskId: string; readonly name: string; readonly onOpenTask: (taskId: TaskId) => void }) {
  const t = useT(), [childId, setChildId] = useState('');
  const client = useQueryClient();
  const detail = useApiQuery(['recovery-detail', taskId], () => api.tasks.describeRecoveryTask(taskId), AUTO_REFRESH);
  const requests = useApiQuery(['recovery-requests', taskId], () => api.tasks.listRecoveries(taskId), { ...AUTO_REFRESH, refetchIntervalMs: (data) => data?.items.some(active) ? 2000 : 30_000 });
  const progress = requests.data?.items.map((r) => `${r.id}:${r.state}`).join('|');
  useEffect(() => {
    if (!progress) return;
    for (const key of [['recovery-detail', taskId], ['recovery-assessment', taskId], ['business-execution-tasks']]) void client.invalidateQueries({ queryKey: key });
  }, [client, taskId, progress]);
  const task = detail.data?.task, child = detail.data?.subtasks.find((s) => s.id === childId);
  return <Stack>
    <QueryStatus isPending={detail.isPending} error={detail.error} />
    {task ? <>
      <p>{t('recovery.workspace', { state: t(`recovery.state.${task.state}`), generation: task.generation })}</p>
      {task.message ? <ActionNote tone={task.state === 'failed' ? 'error' : 'neutral'}>{task.message}</ActionNote> : null}
      <p>{t('recovery.image')}：{task.image ?? task.runtimeImage?.image ?? t('recovery.unknownImage')}</p>
      <FormField label={t('recovery.target')}><select value={childId} onChange={(e) => setChildId(e.target.value)}>
        <option value="">{t('recovery.parent')}</option>{detail.data!.subtasks.map((s) => <option key={s.id} value={s.id}>{s.name} · {t('recovery.attempt', { attempt: s.attempt })} · {t(`recovery.state.${s.state}`)}</option>)}
      </select></FormField>
      {child ? <Stack><p>{child.name} · {t('recovery.attempt', { attempt: child.attempt })} · {t(`recovery.state.${child.state}`)}</p>
        <p>{t('recovery.process')}：{t(`recovery.process.${child.process}`)}</p>
        {child.error ? <ActionNote tone="error">{child.error.message}</ActionNote> : null}
        {child.image ? <p>{t('recovery.image')}：{child.image}</p> : null}
        {child.sessionId ? <details><summary>{t('recovery.session')}</summary><p>{child.sessionId}</p></details> : null}
      </Stack> : null}
      <RecoveryActions key={`${taskId}:${childId}`} taskId={taskId} subtaskId={child?.id} name={child?.name ?? name}
        records={requests.data?.items ?? []} unavailable={!!detail.error || !!requests.error || requests.isPending || (!!childId && !child)} />
    </> : null}
    <QueryStatus isPending={requests.isPending} error={requests.error} />
    {requests.data ? <RecoveryHistory records={requests.data.items} onOpenTask={onOpenTask} /> : null}
  </Stack>;
}

function RecoveryActions({ taskId, subtaskId, name, records, unavailable }: { readonly taskId: string; readonly subtaskId?: string; readonly name: string; readonly records: BusinessRecoveryRequest[]; readonly unavailable: boolean }) {
  const t = useT(), [selection, setSelection] = useState<{ option: Option; input: RequestBusinessRecovery; storage: string }>(), sending = useRef(false);
  const client = useQueryClient();
  const key = ['recovery-assessment', taskId, subtaskId];
  const assessment = useApiQuery(key, () => api.tasks.assessRecovery(taskId, subtaskId), AUTO_REFRESH);
  const action = useApiMutation((input: RequestBusinessRecovery) => api.tasks.requestRecovery(taskId, input), {
    invalidate: [['recovery-requests', taskId], ['recovery-assessment', taskId], ['recovery-detail', taskId], ['business-execution-tasks']],
    onSuccess: () => { if (selection) forgetRequest(selection.storage); setSelection(undefined); },
  });
  const pending = records.some((r) => active(r) && (!subtaskId || !('subtaskId' in r.target) || r.target.subtaskId === subtaskId));
  const blocked = unavailable || !!assessment.error || pending;
  const stillValid = selection && assessment.data?.actions.some((a) => a.assessmentDigest === selection.option.assessmentDigest && JSON.stringify(a.target) === JSON.stringify(selection.option.target));
  const choose = (option: Option) => {
    action.reset(); const storage = `cs:recovery:${taskId}:${option.assessmentDigest}`;
    const requestKey = retainedRequest(storage, records);
    setSelection({ option, storage, input: { ...option, requestKey } });
  };
  const submit = () => {
    if (!selection || blocked || !stillValid || sending.current) return;
    sending.current = true; action.mutate(selection.input, { onError: () => { void client.invalidateQueries({ queryKey: ['recovery-requests', taskId] }); void assessment.refetch(); }, onSettled: () => { sending.current = false; } });
  };
  return <Stack>
    <QueryStatus isPending={assessment.isPending} error={assessment.error} />
    {pending ? <ActionNote tone="neutral">{t('recovery.inProgress')}</ActionNote> : null}
    {assessment.data?.reasons.map((reason) => <ActionNote key={reason} tone="neutral">{t(`recovery.reason.${reason}`)}</ActionNote>)}
    <ActionRow>{assessment.data?.actions.map((option) => <Button key={option.target.action} disabled={blocked || action.isPending} onClick={() => choose(option)}>{t(`recovery.action.${option.target.action}`)}</Button>)}</ActionRow>
    {selection ? <ConfirmationDialog title={t(`recovery.action.${selection.option.target.action}`)} question={t('recovery.confirmQuestion', { name })}
      hint={t(`recovery.effect.${selection.option.target.action}`)} confirmLabel={t('recovery.confirm')} busyLabel={t('recovery.submitting')} busy={action.isPending}
      confirmDisabled={blocked || !stillValid} onConfirm={submit} onCancel={() => setSelection(undefined)} danger={['retry-subtask', 'restart-task'].includes(selection.option.target.action)}>
      <p>{t('recovery.pinned')}</p>{!stillValid ? <ActionNote tone="error">{t('recovery.changed')}</ActionNote> : null}
      {action.error ? <ActionNote tone="error">{errorMessage(action.error)}</ActionNote> : null}
    </ConfirmationDialog> : null}
  </Stack>;
}
function retainedRequest(storage: string, records: BusinessRecoveryRequest[]): string {
  let prior: string | null = null; try { prior = sessionStorage.getItem(storage); } catch { /* Storage may be disabled. The mounted confirmation still retains its key. */ }
  if (prior && !records.some((r) => r.requestKey === prior && !active(r))) return prior;
  const key = crypto.randomUUID(); try { sessionStorage.setItem(storage, key); } catch { /* Keep the in-memory request. */ } return key;
}
function forgetRequest(storage: string) { try { sessionStorage.removeItem(storage); } catch { /* Storage may be disabled. */ } }
