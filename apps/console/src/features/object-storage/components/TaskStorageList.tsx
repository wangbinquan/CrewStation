import { useState } from 'react';
import type { BusinessExecutionTaskItem, BusinessExecutionTaskQuery } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { TaskStorageStatus } from './TaskStorageStatus';
import { storageTime } from '../model/storageValues';

export function TaskStorageList({ projectId }: { projectId: string }) {
  const t = useT(), [selected, setSelected] = useState<BusinessExecutionTaskItem>(), [cursor, setCursor] = useState<string>(), [state, setState] = useState<BusinessExecutionTaskQuery['state']>();
  const query = useApiQuery(['object-storage', 'tasks', projectId, state, cursor], () => api.objectStorage.tasks(projectId, { state, cursor, limit: 30 }), AUTO_REFRESH);
  const name = (item: BusinessExecutionTaskItem) => item.labels.name || item.labels.title || item.id;
  return <><Card title={t('objects.taskStorage')} stacked><p>{t('objects.taskStorageHint')}</p>
    <FormField label={t('recovery.filter')}><select value={state ?? ''} onChange={(e) => { setState((e.target.value || undefined) as typeof state); setCursor(undefined); }}>
      <option value="">{t('recovery.allStates')}</option>{(['failed', 'unknown', 'paused', 'running', 'closed'] as const).map((v) => <option key={v} value={v}>{t(`recovery.filter.${v}`)}</option>)}
    </select></FormField>
    <QueryStatus isPending={query.isPending} error={query.error} isEmpty={query.data?.items.length === 0} emptyTitle={t('objects.noTasks')} />
    {query.data?.items.length ? <DataTable columns={[t('objects.task'), t('objects.state'), t('objects.stateUpdated'), t('objects.actions')]}>{query.data.items.map((item) => <tr key={item.id}>
      <td>{name(item)}</td><td>{t(`recovery.state.${item.state}`)}</td><td>{storageTime(item.updatedAt)}</td><td><Button size="small" onClick={() => setSelected(item)}>{t('objects.historyDetails')}</Button></td>
    </tr>)}</DataTable> : null}
    <ActionRow>{cursor ? <Button onClick={() => setCursor(undefined)}>{t('objects.first')}</Button> : null}{query.data?.next ? <Button onClick={() => setCursor(query.data!.next)}>{t('objects.next')}</Button> : null}</ActionRow>
  </Card>{selected ? <Dialog title={name(selected)} size="large" onClose={() => setSelected(undefined)}>
    {selected.protocol === 'v3' ? <TaskStorageStatus key={selected.id} taskId={selected.id} /> : <p>{t('objects.legacyPolicy')}</p>}
  </Dialog> : null}</>;
}
