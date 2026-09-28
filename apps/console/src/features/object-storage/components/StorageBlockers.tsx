import { useState } from 'react';
import type { ObjectStorageBlocker, ObjectStorageBlockerPage } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { storageTime } from '../model/storageValues';
import { TaskStorageStatus } from './TaskStorageStatus';
import styles from './Storage.module.css';

export function StorageBlockers({ target, initial }: { target: { backendId: string } | { spaceId: string }; initial: ObjectStorageBlockerPage }) {
  const t = useT(), [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), [selected, setSelected] = useState<ObjectStorageBlocker>();
  const cursor = cursors.at(-1);
  const query = useApiQuery(['object-storage', 'blockers', target, cursor], () => api.objectStorage.blockers(target, { cursor, limit: 100 }), { ...AUTO_REFRESH, enabled: !!cursor });
  const page = cursor ? query.data : initial;
  return <Card title={t('objects.blockers')} stacked>
    {cursor ? <QueryStatus isPending={query.isPending} error={query.error} /> : null}
    {page?.items.length ? <DataTable columns={[t('objects.task'), t('objects.phase'), t('objects.reason'), t('objects.actions')]}>{page.items.map((b) => <tr key={b.operationId}>
      <td className={styles.code}>{b.taskId}</td><td>{t(`objects.phase.${b.phase}`)}</td><td>{b.message}<span className={`${styles.muted} ${styles.compact}`}>{b.code} · {storageTime(b.since)}</span></td>
      <td><Button size="small" onClick={() => setSelected(b)}>{t('objects.blockerDetails')}</Button></td>
    </tr>)}</DataTable> : page ? <p className={styles.muted}>{t('objects.noBlockers')}</p> : null}
    {cursors.length > 1 || page?.nextCursor ? <ActionRow><Button disabled={cursors.length === 1} onClick={() => setCursors((old) => old.slice(0, -1))}>{t('objects.previous')}</Button><Button disabled={!page?.nextCursor} onClick={() => setCursors((old) => [...old, page!.nextCursor!])}>{t('objects.next')}</Button></ActionRow> : null}
    {selected ? <Dialog title={t('objects.blockerDetails')} onClose={() => setSelected(undefined)}><dl className={styles.stats}>
      {([['task', selected.taskId], ['operation', selected.operationId], ['phase', t(`objects.phase.${selected.phase}`)], ['reason', selected.message], ['errorCode', selected.code], ['oldest', storageTime(selected.since)]] as const).map(([key, value]) => <div key={key}><dt>{t(`objects.${key}`)}</dt><dd>{value}</dd></div>)}
    </dl><TaskStorageStatus taskId={selected.taskId} /><p>{t('objects.volumeRetained')}</p></Dialog> : null}
  </Card>;
}
