import { useState } from 'react';
import type { ArchiveReceiptDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Button, buttonClassName } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { storageBytes, storageTime } from '../model/storageValues';
import { ArtifactDeletionDialog } from './ArtifactDeletionDialog';
import styles from './Storage.module.css';

export function ReceiptItems({ receipt, canDelete = false }: { receipt: ArchiveReceiptDto; canDelete?: boolean }) {
  const t = useT(), [offsets, setOffsets] = useState([0]), offset = offsets.at(-1)!, [deleting, setDeleting] = useState(false);
  const page = useApiQuery(['object-storage', 'receipt', receipt.id, offset], () => api.objectStorage.receiptItems(receipt.finalizationId, { offset, limit: 50 }));
  const matching = page.data?.receipt.id === receipt.id;
  return <Card title={t('objects.receiptFiles')} stacked>
    <QueryStatus isPending={page.isPending} error={page.error} />
    {page.data && !matching ? <p role="alert">{t('objects.receiptChanged')}</p> : null}
    {matching && page.data?.artifactsDeleted ? <p role="status">{t('objects.artifactsDeleted', { at: storageTime(page.data.artifactsDeleted.deletedAt), count: page.data.artifactsDeleted.retainedObjectCount })} {page.data.artifactsDeleted.reason}</p> : null}
    {matching && page.data!.items.length === 0 ? <p>{t('objects.noReceiptFiles')}</p> : null}
    {matching && page.data!.items.length ? <DataTable columns={[t('objects.name'), t('objects.state'), t('objects.size'), t('objects.digestOrReason'), t('objects.actions')]}>
      {page.data!.items.map((item) => <tr key={item.name}><td className={styles.code}>{item.name}</td><td>{t(`objects.item.${item.state}`)}</td>
        <td>{item.state === 'saved' ? storageBytes(item.size) : '—'}</td><td className={styles.code}>{item.state === 'saved' ? item.sha256 : item.reason}</td>
        <td>{item.state === 'saved' && !page.data?.artifactsDeleted ? <a className={buttonClassName('secondary', 'small')} href={api.objectStorage.downloadUrl(item.objectId)} download>{t('objects.download')}</a> : '—'}</td></tr>)}
    </DataTable> : null}
    <ActionRow><Button disabled={offsets.length === 1} onClick={() => setOffsets((old) => old.slice(0, -1))}>{t('objects.previous')}</Button>
      <Button disabled={!matching || page.data?.nextOffset == null} onClick={() => setOffsets((old) => [...old, page.data!.nextOffset!])}>{t('objects.next')}</Button></ActionRow>
    {canDelete && matching && !page.data?.artifactsDeleted ? <Button variant="danger" onClick={() => setDeleting(true)}>{t('objects.deleteArtifacts')}</Button> : null}
    <ArtifactDeletionDialog key={receipt.id} receipt={receipt} open={deleting} close={() => setDeleting(false)} />
  </Card>;
}
