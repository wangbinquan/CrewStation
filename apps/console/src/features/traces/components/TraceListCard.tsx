import type { ReactElement } from 'react';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { MetaLine, ResourceRow } from '../../../shared/ui/resource/ResourceList';
import { TRACE_PAGE_SIZE, useTraceList, useUserNames } from '../hooks/useTraceReads';
import { rowFacts, rowTitle, statusTone } from '../model/traceView';
import type { TraceFilters } from '../model/traceView';
import { TraceFilterBar, TraceOpenForm } from './TraceListControls';
import styles from './Trace.module.css';

interface TraceListCardProps {
  readonly projectId: string;
  readonly filters: TraceFilters;
  readonly selected?: string;
  readonly onFilters: (next: TraceFilters) => void;
  readonly onOpen: (traceId: string) => void;
}

/** 调用链列表：按开始时间倒序，一行一条链；点一行在右侧打开回放，底部「加载更多」接着往前翻。 */
export function TraceListCard({ projectId, filters, selected, onFilters, onOpen }: TraceListCardProps): ReactElement {
  const t = useT(), dateText = useDateText(), names = useUserNames(projectId);
  const list = useTraceList(projectId, filters);
  const pages = list.data?.pages ?? [];
  const rows = [...new Map(pages.flatMap((page) => page.items).map((row) => [row.traceId, row])).values()];
  const filtered = Boolean(filters.source || filters.status || filters.window !== 'all');
  const last = pages.at(-1), cursor = last?.nextCursor;
  // 一页没找够就给了游标：服务端扫到了轮数上限，写明查到了哪一刻，按钮改叫「继续往前查找」。
  const partial = Boolean(cursor && last && last.items.length < TRACE_PAGE_SIZE);
  // 行与「加载更多」在一个滚动区里：宽屏两栏长满可视高度时只有它滚，筛选与「按 trace_id 打开」停在上面。
  return <Card stacked compact className={styles.listCard} title={t('traces.list.title')}>
    <TraceFilterBar filters={filters} onChange={onFilters} />
    <TraceOpenForm onOpen={onOpen} />
    <QueryStatus isPending={list.isPending} error={list.error} />
    {list.data && rows.length === 0 && !cursor ? <EmptyState title={t(filtered ? 'traces.list.emptyFiltered' : 'traces.list.empty')} {...(filtered ? {} : { description: t('traces.list.emptyHint') })} /> : null}
    {rows.length > 0 || cursor ? <div className={styles.listScroll}>
    {rows.length > 0 ? <ul className={styles.rows} aria-label={t('traces.list.label')}>
      {rows.map((row) => <ResourceRow key={row.traceId} plain current={row.traceId === selected} onActivate={() => onOpen(row.traceId)} activateLabel={row.traceId}
        title={rowTitle(row, names, t)} meta={<MetaLine parts={[dateText(row.startedAt), ...rowFacts(row, t)]} />}
        trailing={<Badge tone={statusTone(row.status)}>{t(`traces.status.${row.status}`)}</Badge>} />)}
    </ul> : null}
    {cursor ? <div className={styles.more}>
      <Button disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t(partial ? 'traces.list.keepLooking' : 'traces.list.more')}</Button>
      {partial ? <span className={styles.muted}>{t('traces.list.scanned', { time: dateText(cursor.split('~')[0]) })}</span> : null}
    </div> : null}
    </div> : null}
  </Card>;
}
