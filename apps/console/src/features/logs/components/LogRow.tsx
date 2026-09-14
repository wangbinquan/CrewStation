import type { LogEntryDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { LogLevelBadge, logLevelOf } from './LogLevelBadge';
import styles from './LogRow.module.css';

export interface LogRowProps {
  readonly entry: LogEntryDto;
  /** 时间格式化器由列表建好传进来，避免每行各建一个 Intl 实例。 */
  readonly formatTime: (ts: string) => string;
}

/** 一行日志：时间、级别、来源／槽、正文；正文换行而不横向溢出。 */
export function LogRow({ entry, formatTime }: LogRowProps): ReactElement {
  const t = useT();
  const source = t(`logs.source.${entry.source}`);
  const origin = entry.slot === undefined ? source : `${source}·${entry.slot}`;
  return (
    <div className={styles.row}>
      <span className={styles.time} title={entry.ts}>{entry.ts === undefined ? t('logs.timeUnknown') : formatTime(entry.ts)}</span>
      <LogLevelBadge level={logLevelOf(entry)} />
      <span className={styles.origin} title={entry.pod ?? origin}>
        {origin}
      </span>
      <span className={styles.message}>{entry.message}</span>
    </div>
  );
}
