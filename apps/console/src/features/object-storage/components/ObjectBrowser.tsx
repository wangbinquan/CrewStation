import { useState } from 'react';
import type { StoredObjectDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Badge } from '../../../shared/ui/Badge';
import { Button, buttonClassName } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Stack } from '../../../shared/ui/Stack';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { storageBytes, storageTime } from '../model/storageValues';
import styles from './Storage.module.css';

export function ObjectBrowser({ spaceId }: { spaceId: string }) {
  const t = useT(), [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), [selected, setSelected] = useState<string>();
  const page = useApiQuery(['object-storage', 'objects', spaceId, cursors.at(-1)], () => api.objectStorage.objects(spaceId, { cursor: cursors.at(-1), limit: 50 }), AUTO_REFRESH);
  return <Stack><QueryStatus isPending={page.isPending} error={page.error} />
    {page.data?.items.length === 0 ? <EmptyState title={t('objects.noItems')} /> : null}
    {page.data?.items.length ? <DataTable columns={[t('objects.name'), t('objects.size'), t('objects.state'), t('objects.references'), t('objects.actions')]}>{page.data.items.map((o) => <tr key={o.id}>
      <td>{o.name}</td><td>{storageBytes(o.size)}</td><td><Badge tone={o.state === 'degraded' ? 'danger' : o.state === 'ready' ? 'success' : 'neutral'}>{t(`objects.${o.state}`)}</Badge></td><td>{o.referenceCount}</td>
      <td><Button size="small" onClick={() => setSelected(o.id)}>{t('objects.details')}</Button></td>
    </tr>)}</DataTable> : null}
    <ActionRow><Button disabled={cursors.length === 1} onClick={() => setCursors((old) => old.slice(0, -1))}>{t('objects.previous')}</Button><Button disabled={!page.data?.nextCursor} onClick={() => setCursors((old) => [...old, page.data!.nextCursor!])}>{t('objects.next')}</Button></ActionRow>
    {selected ? <ObjectDetail id={selected} close={() => setSelected(undefined)} /> : null}
  </Stack>;
}
function ObjectDetail({ id, close }: { id: string; close: () => void }) {
  const t = useT(), object = useApiQuery(['object-storage', 'object', id], () => api.objectStorage.object(id), AUTO_REFRESH);
  return <Dialog title={object.data?.name ?? t('objects.details')} onClose={close}><QueryStatus isPending={object.isPending} error={object.error} />{object.data ? <ObjectFacts object={object.data} /> : null}</Dialog>;
}
function ObjectFacts({ object }: { object: StoredObjectDto }) {
  const t = useT();
  const facts = [['name', object.name], ['size', storageBytes(object.size)], ['state', t(`objects.${object.state}`)], ['digest', object.sha256], ['references', object.referenceCount], ['created', storageTime(object.createdAt)], ['verified', storageTime(object.verifiedAt)]];
  return <Stack><dl className={styles.stats}>{facts.map(([label, value]) => <div key={label}><dt>{t(`objects.${label}`)}</dt><dd>{value}</dd></div>)}</dl><p className={styles.code}>{object.id}</p>{object.message ? <p role="status">{object.message}</p> : null}
    {object.state === 'ready' ? <ActionRow><a className={buttonClassName()} href={api.objectStorage.downloadUrl(object.id)} download>{t('objects.download')}</a></ActionRow> : null}
  </Stack>;
}
