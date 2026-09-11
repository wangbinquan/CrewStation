import type { LogQueryInput } from '@crewstation/api-client';
import type { LogEntryDto, LogSource, SlotName } from '@crewstation/contracts';
import { useCallback, useMemo, useState } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { usePollingRefetch } from './usePollingRefetch';

/** 跟随时的重取间隔；与页面说明里的「每 5 秒」一致。 */
const FOLLOW_POLL_MS = 5_000;

export interface LogFilterValues {
  readonly source: LogSource;
  /** 空串表示不限部署槽；只有 source 为 slot 时服务端才会用到。 */
  readonly slot: SlotName | '';
  readonly limit: number;
  /** 页内关键字，前端过滤，不进请求。 */
  readonly text: string;
}

export const DEFAULT_LOG_FILTERS: LogFilterValues = { source: 'slot', slot: 'prod', limit: 200, text: '' };

export interface LogFeed {
  readonly filters: LogFilterValues;
  readonly changeFilters: (next: LogFilterValues) => void;
  readonly entries: readonly LogEntryDto[];
  readonly total: number;
  readonly isPending: boolean;
  readonly error: unknown;
  readonly follow: boolean;
  readonly changeFollow: (follow: boolean) => void;
  readonly hasOlder: boolean;
  readonly hasNewer: boolean;
  readonly goOlder: () => void;
  readonly goNewer: () => void;
}

/**
 * 一页日志加翻页游标栈：栈为空即最新一页，向前翻就压入服务端给的 nextCursor，回退即出栈。
 * 跟随只在最新一页有意义，翻历史页与改筛选条件都会把栈清空。
 */
export function useLogFeed(projectId: string): LogFeed {
  const [filters, setFilters] = useState<LogFilterValues>(DEFAULT_LOG_FILTERS);
  const [cursors, setCursors] = useState<readonly string[]>([]);
  const [follow, setFollow] = useState(true);
  const enabled = projectId !== '';
  const request: LogQueryInput = {
    source: filters.source,
    slot: filters.slot === '' ? undefined : filters.slot,
    limit: filters.limit,
    cursor: cursors[cursors.length - 1],
  };
  const query = useApiQuery([...queryKeys.logs(projectId), request], () => api.observability.logs(projectId, request), { enabled });
  usePollingRefetch(query.refetch, FOLLOW_POLL_MS, enabled && follow && cursors.length === 0);

  const items = query.data?.items;
  const needle = filters.text.trim().toLowerCase();
  // ISO 时间串按字典序即按时间序，最新的排在最后，跟随时滚到底就是最新一条。
  const entries = useMemo(() => {
    const page = items ?? [];
    const matched = needle === '' ? page : page.filter((entry) => entry.message.toLowerCase().includes(needle));
    return [...matched].sort((left, right) => left.ts.localeCompare(right.ts));
  }, [items, needle]);

  const nextCursor = query.data?.nextCursor;
  const changeFilters = useCallback((next: LogFilterValues) => {
    setFilters(next);
    setCursors([]);
  }, []);
  const changeFollow = useCallback((next: boolean) => {
    setFollow(next);
    if (next) setCursors([]);
  }, []);
  const goOlder = useCallback(() => {
    if (nextCursor === undefined) return;
    setFollow(false);
    setCursors((previous) => [...previous, nextCursor]);
  }, [nextCursor]);
  const goNewer = useCallback(() => {
    setCursors((previous) => previous.slice(0, -1));
  }, []);

  return {
    filters, changeFilters, entries, total: items?.length ?? 0,
    isPending: query.isPending, error: query.error, follow, changeFollow,
    hasOlder: nextCursor !== undefined, hasNewer: cursors.length > 0, goOlder, goNewer,
  };
}
