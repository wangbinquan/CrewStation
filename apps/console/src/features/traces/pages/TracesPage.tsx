import type { TraceSource, TraceStatus, TraceWindow } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { TraceDetail } from '../components/TraceDetail';
import { TraceListCard } from '../components/TraceListCard';
import { filtersFromSearch } from '../model/traceView';
import type { TraceFilters } from '../model/traceView';
import styles from './TracesPage.module.css';

/** 调用链页签在地址里的状态：选中的链与三个筛选；缺省即「全部」。 */
export interface TracesSearch {
  readonly traceId?: string;
  readonly traceSource?: TraceSource;
  readonly traceStatus?: TraceStatus;
  readonly traceWindow?: TraceWindow;
}

const toSearch = (filters: TraceFilters): TracesSearch => ({
  ...(filters.source ? { traceSource: filters.source } : {}), ...(filters.status ? { traceStatus: filters.status } : {}), ...(filters.window !== 'all' ? { traceWindow: filters.window } : {}),
});

/**
 * 运行与诊断 → 调用链（2026-09-23 作者裁定，修订 RFC-020 §4.5）：左边是本应用全部调用链的列表（来源、状态、时间筛选，
 * 可粘贴 trace_id 直接打开），右边是选中那条的分层回放；窄时列表在上、详情在下。
 */
export function TracesPage({ projectId, search, onChange }: { readonly projectId: string; readonly search: TracesSearch; readonly onChange: (next: TracesSearch, replace?: boolean) => void }): ReactElement {
  const filters = filtersFromSearch(search);
  return <div className={styles.host}>
    <div className={styles.columns}>
      <TraceListCard projectId={projectId} filters={filters} selected={search.traceId}
        onFilters={(next) => onChange({ ...(search.traceId ? { traceId: search.traceId } : {}), ...toSearch(next) }, true)}
        onOpen={(traceId) => onChange({ ...toSearch(filters), traceId })} />
      <div className={styles.aside}><TraceDetail projectId={projectId} traceId={search.traceId} /></div>
    </div>
  </div>;
}
