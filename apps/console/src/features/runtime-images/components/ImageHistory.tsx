import { ExternalButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import { VersionIdentity } from './VersionIdentity';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import styles from './RuntimeImages.module.css';

export function ImageHistory({ projectId, imageId, versionId }: { readonly projectId: string; readonly imageId: string; readonly versionId?: string }) {
  const t = useT(), [before, setBefore] = useState<string>();
  const history = useApiQuery(['runtime-images', projectId, imageId, 'history', versionId, before], () => api.runtimeImages.history(projectId, imageId, { versionId, before, limit: 20 }), AUTO_REFRESH);
  return <div className={styles.stack}><h3>{t('images.history')}</h3><p className={styles.note}>{t('images.historyHint')}</p>
    <QueryStatus isPending={history.isPending} error={history.error} isEmpty={history.data?.items.length === 0} emptyTitle={t('images.historyEmpty')} />
    {history.data?.items.length ? <DataTable columns={[t('images.execution'), t('images.state'), t('images.created'), t('images.version'), t('images.actions')]}>
      {history.data.items.map((row) => <tr key={row.id}><td>{t(`images.history.${row.kind}`)}<p>{row.name || t('images.taskNumber', { id: row.id.slice(-12) })}</p>{row.parentTaskId ? <small>{t('images.parentTask', { id: row.parentTaskId.slice(-12) })}</small> : null}</td>
        <td>{t(`images.executionState.${row.state}`)}{row.message ? <p>{row.message}</p> : null}</td><td>{new Date(row.createdAt).toLocaleString()}</td><td><VersionIdentity projectId={projectId} versionId={row.versionId} /></td>
        <td><ExternalButtonLink size="small" href={row.kind === 'service' ? `/projects/${projectId}/release?release=${encodeURIComponent(row.id)}` : `/projects/${projectId}/operations?tab=trace&traceId=${encodeURIComponent(row.traceId ?? '')}`}>{t('images.executionDetails')}</ExternalButtonLink></td></tr>)}
    </DataTable> : null}
    <div className={styles.row}>{before ? <Button onClick={() => setBefore(undefined)}>{t('images.first')}</Button> : null}{history.data?.next ? <Button onClick={() => setBefore(history.data!.next)}>{t('images.next')}</Button> : null}</div>
  </div>;
}
