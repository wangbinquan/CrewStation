import { useState } from 'react';
import type { ObjectArchiveHistoryItem } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Stack } from '../../../shared/ui/Stack';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { storageTime } from '../model/storageValues';
import { TaskStorageStatus } from './TaskStorageStatus';
import styles from './Storage.module.css';

export function StorageHistory({ target }: { target: { backendId: string } | { spaceId: string } }) {
  const t = useT(), [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), [selected, setSelected] = useState<ObjectArchiveHistoryItem>();
  const cursor = cursors.at(-1), page = useApiQuery(['object-storage', 'history', target, cursor], () => api.objectStorage.archiveHistory(target, { cursor, limit: 50 }), AUTO_REFRESH);
  return <Stack><p>{t('objects.historyHint')}</p><QueryStatus isPending={page.isPending} error={page.error} />
    {page.data?.items.length ? <DataTable columns={[t('objects.task'), t('objects.state'), t('objects.stateUpdated'), t('objects.actions')]}>{page.data.items.map((item) => <tr key={item.operationId}>
      <td className={styles.code}>{item.taskId}</td><td>{t(`objects.binding.${item.state}`)}</td><td>{storageTime(item.updatedAt)}</td>
      <td><Button size="small" onClick={() => setSelected(item)}>{t('objects.historyDetails')}</Button></td>
    </tr>)}</DataTable> : page.data ? <p>{t('objects.noHistory')}</p> : null}
    <ActionRow><Button disabled={cursors.length === 1} onClick={() => setCursors((old) => old.slice(0, -1))}>{t('objects.previous')}</Button><Button disabled={!page.data?.nextCursor} onClick={() => setCursors((old) => [...old, page.data!.nextCursor!])}>{t('objects.next')}</Button></ActionRow>
    {selected ? <Dialog title={t('objects.historyDetails')} onClose={() => setSelected(undefined)} size="large">
      <p className={styles.code}>{t('objects.operation')}: {selected.operationId}</p>
      <TaskStorageStatus taskId={selected.taskId} operationId={selected.operationId} />
    </Dialog> : null}
  </Stack>;
}
