import { useState } from 'react';
import type { ObjectStorageObservation, ObjectStorageSample, StorageWindow } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Stack } from '../../../shared/ui/Stack';
import { Tabs } from '../../../shared/ui/Tabs';
import { TimeSeries } from '../../../shared/ui/TimeSeries';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { storageBytes, storageTime, storageTone } from '../model/storageValues';
import { ObjectBrowser } from './ObjectBrowser';
import { StorageBlockers } from './StorageBlockers';
import { StorageHistory } from './StorageHistory';
import { StorageBackup } from './StorageBackup';
import styles from './Storage.module.css';

type StorageTarget = { name: string; backendId: string } | { name: string; spaceId: string };
export function StorageDialog({ target, close }: { target: StorageTarget; close: () => void }) {
  const t = useT(), [window, setWindow] = useState<StorageWindow>('1h'), [tab, setTab] = useState('observation');
  const scope = 'backendId' in target ? { backendId: target.backendId } : { spaceId: target.spaceId };
  const observation = useApiQuery(['object-storage', 'observation', scope, window], () => api.objectStorage.observation(scope, window), { ...AUTO_REFRESH, enabled: tab === 'observation' });
  return <Dialog title={target.name} onClose={close} size="large">
    <Tabs label={t('objects.title')} value={tab} onChange={setTab} items={[{ value: 'observation', label: t('objects.inspect') }, { value: 'history', label: t('objects.history') }, ...('spaceId' in target ? [{ value: 'objects', label: t('objects.items') }] : [])]}>
      {tab === 'history' ? <StorageHistory target={scope} /> : tab === 'objects' && 'spaceId' in target ? <ObjectBrowser spaceId={target.spaceId} /> : <Stack>
        <ActionRow><label>{t('objects.window')} <select value={window} onChange={(e) => setWindow(e.target.value as StorageWindow)}>{(['1h', '6h', '24h', '7d'] as const).map((w) => <option value={w} key={w}>{t(`cluster.history.${w}`)}</option>)}</select></label></ActionRow>
        <QueryStatus isPending={observation.isPending} error={observation.error} />
        {observation.data ? <StorageObservation value={observation.data} /> : null}
      </Stack>}
    </Tabs>
  </Dialog>;
}

function StorageObservation({ value }: { value: ObjectStorageObservation }) {
  const t = useT();
  const facts = (rows: [string, string | number][]) => <dl className={styles.stats}>{rows.map(([key, text]) => <div key={key}><dt>{t(`objects.${key}`)}</dt><dd>{text}</dd></div>)}</dl>;
  return <Stack>
    <ActionRow><Badge tone={storageTone(value.health)}>{t(`objects.${value.health}`)}</Badge><span className={styles.muted}>{t('objects.updated')}: {storageTime(value.observedAt)}</span></ActionRow>
    <Card title={t('objects.logical')}>{facts([['used', storageBytes(value.logical.usedBytes)], ['reserved', storageBytes(value.logical.reservedBytes)], ['deleting', storageBytes(value.logical.deletingBytes)], ['capacity', storageBytes(value.logical.quotaBytes)]])}</Card>
    <Card title={t('objects.physical')} footer={`${t('objects.physicalHint')} ${t('objects.updated')}: ${storageTime(value.physical.observedAt)}`}>{facts([['physicalFree', storageBytes(value.physical.freeBytes)], ['physicalTotal', storageBytes(value.physical.totalBytes)], ['backup', value.lastBackupAt ? storageTime(value.lastBackupAt) : t('objects.neverBackup')]])}</Card>
    {value.backup ? <StorageBackup value={value.backup} /> : null}
    <Card title={t('objects.queue')}>{facts([['uploading', value.queue.uploading], ['verifying', value.queue.verifying], ['deleting', value.queue.deleting], ['failed', value.queue.failed], ['unknownWrites', value.queue.unknownWrites], ['activeDownloads', value.queue.activeDownloads], ['unknownDownloads', value.queue.unknownDownloads], ['pendingBytes', storageBytes(value.queue.pendingBytes)], ['oldest', storageTime(value.queue.oldestPendingAt)]])}</Card>
    {value.stale || value.unavailableReason ? <p role="status" className={styles.warning}>{t('objects.stale')} · {value.unavailableReason}</p> : null}
    {value.samples.length ? <StorageCharts samples={value.samples} /> : <EmptyState title={t('objects.noSamples')} />}
    <StorageBlockers target={value.spaceId ? { spaceId: value.spaceId } : { backendId: value.backendId }} initial={{ items: value.blockers, nextCursor: value.blockersNextCursor }} />
  </Stack>;
}
function StorageCharts({ samples }: { samples: ObjectStorageSample[] }) {
  const t = useT();
  const metrics = ['readBytesPerSecond', 'writeBytesPerSecond', 'requestsPerSecond', 'errorRatio', 'p95Seconds'] as const;
  return <div className={styles.charts}>{metrics.map((key) => <TimeSeries key={key} single title={t(`objects.${key}`)}
    points={samples.map((sample) => ({ at: sample.at, average: sample[key], peak: null, coverage: sample[key] === null ? 0 : 1, complete: sample[key] !== null }))}
    format={(n) => key.includes('Bytes') ? `${storageBytes(n)}/s` : key === 'errorRatio' ? `${(n * 100).toFixed(1)}%` : `${n.toFixed(2)} ${key === 'p95Seconds' ? 's' : '/s'}`}
    labels={{ average: t('objects.sample'), peak: t('objects.sample'), coverage: t('objects.coverage'), select: t('objects.selectPoint'), gap: t('objects.gap') }} />)}</div>;
}
