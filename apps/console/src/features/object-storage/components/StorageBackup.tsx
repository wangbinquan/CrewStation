import type { ObjectBackupObservation } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { Stack } from '../../../shared/ui/Stack';
import { storageBytes, storageTime } from '../model/storageValues';
import styles from './Storage.module.css';

export function StorageBackup({ value }: { value: ObjectBackupObservation }) {
  const t = useT(), record = value.latest;
  return <Card title={t('objects.backupHistory')}><Stack>
    <p>{t('objects.backupScope')}</p>
    {record ? <>
      <p role="status" className={record.state === 'failed' || record.state === 'aborted' ? styles.warning : undefined}>{t(`objects.backupState.${record.state}`)}</p>
      <dl className={styles.stats}>{[
        ['backupDestination', record.destination], ['backupReason', record.reason], ['backupStarted', storageTime(record.startedAt)],
        ['updated', storageTime(record.updatedAt)], ['backupObjects', record.objectCount], ['backupBytes', storageBytes(record.bytes)],
        ['backupLastSuccess', storageTime(value.lastSucceededAt)], ['backupRestore', value.lastRestoreVerifiedAt ? storageTime(value.lastRestoreVerifiedAt) : t('objects.backupNeverRestore')],
      ].map(([key, text]) => <div key={key}><dt>{t(`objects.${key}`)}</dt><dd>{text}</dd></div>)}</dl>
      {record.errorCode ? <p>{t(`objects.backupError.${record.errorCode}`)}</p> : null}
      {record.manifestDigest ? <p className={styles.muted}>SHA-256: {record.manifestDigest}</p> : null}
    </> : <p>{t('objects.neverBackup')}</p>}
  </Stack></Card>;
}
