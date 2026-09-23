import type { ReactElement } from 'react';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { useTraceEvents } from '../hooks/useTraceReads';
import { describeTraceEvent } from '../model/traceEventText';
import styles from './Trace.module.css';

/** 一个 Agent 执行的事件：展开时才读，按序号往后翻；平台自己执行的命令不在里面。 */
export function TraceEvents({ projectId, traceId, taskId, label }: { readonly projectId: string; readonly traceId: string; readonly taskId: string; readonly label: string }): ReactElement {
  const t = useT(), dateText = useDateText();
  const events = useTraceEvents(projectId, traceId, taskId, true);
  const items = events.data?.pages.flatMap((page) => page.items) ?? [];
  const cursor = events.data?.pages.at(-1)?.nextCursor;
  return <div className={styles.node}>
    <QueryStatus isPending={events.isPending} error={events.error} />
    {events.data && items.length === 0 ? <p className={styles.muted}>{t('traces.events.empty')}</p> : null}
    {items.length > 0 ? <ol className={styles.events} aria-label={t('traces.events.label', { name: label })}>
      {items.map((event) => {
        const text = describeTraceEvent(event, t);
        return <li key={event.seq} className={styles.event}>
          <time className={styles.eventTime} dateTime={event.at}>{dateText(event.at)}</time>
          <span className={styles.eventBody}><span className={text.failed ? `${styles.eventKind} ${styles.error}` : styles.eventKind}>{text.kind}</span>{text.detail ? ` · ${text.detail}` : ''}</span>
        </li>;
      })}
    </ol> : null}
    {cursor ? <div><Button size="small" disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>{t('traces.events.more')}</Button></div> : null}
  </div>;
}
