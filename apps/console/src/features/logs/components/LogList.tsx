import type { LogEntryDto } from '@crewstation/contracts';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';
import { useI18n } from '../../../shared/lib/useI18n';
import { LogRow } from './LogRow';
import styles from './LogList.module.css';

/** 距底部不超过这个像素数就算“停在最新”，用户向上翻时自动置底暂停。 */
const PIN_THRESHOLD_PX = 24;

export interface LogListProps {
  readonly entries: readonly LogEntryDto[];
  readonly follow: boolean;
}

/** 日志视口：等宽密排，跟随时自动滚到底；日志没有 id，用时间加下标作 key。 */
export function LogList({ entries, follow }: LogListProps): ReactElement {
  const { locale } = useI18n();
  const viewport = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }), [locale]);
  const formatTime = useCallback(
    (ts: string) => {
      const date = new Date(ts);
      return Number.isNaN(date.getTime()) ? ts : formatter.format(date);
    },
    [formatter],
  );
  useEffect(() => {
    const element = viewport.current;
    if (element === null || !follow || !pinned.current) return;
    element.scrollTop = element.scrollHeight;
  }, [entries, follow]);
  const handleScroll = (): void => {
    const element = viewport.current;
    if (element === null) return;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight <= PIN_THRESHOLD_PX;
  };
  return (
    <div className={styles.viewport} ref={viewport} onScroll={handleScroll} role="log" aria-live={follow ? 'polite' : 'off'}>
      {entries.map((entry, index) => (
        <LogRow key={`${entry.ts}#${index}`} entry={entry} formatTime={formatTime} />
      ))}
    </div>
  );
}
