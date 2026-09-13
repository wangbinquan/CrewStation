import type { LogQueryInput } from '@crewstation/api-client';
import { TaskIdSchema } from '@crewstation/contracts';
import type { LogEntryDto, LogSource, SlotName } from '@crewstation/contracts';
import { useCallback, useMemo, useState } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { usePollingRefetch } from '../../../shared/lib/usePollingRefetch';
import type { OperationsSearch } from '../../../shared/project/operationsSearch';

/** 跟随时的重取间隔；与页面说明里的「每 5 秒」一致。 */
const FOLLOW_POLL_MS = 5_000;

export interface LogFilterValues {
  readonly source: LogSource;
  /** 空串表示不限部署槽；只有 source 为 slot 时服务端才会用到。 */
  readonly slot: SlotName | '';
  readonly limit: number;
  /** 页内关键字，前端过滤，不进请求。 */
  readonly text: string;
  readonly taskId?: string;
  readonly releaseId?: string;
  readonly since?: string;
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
}

/**
 * 最新一页日志：首版日志源直接读 Pod 日志尾部，Kubernetes 的接口没有游标，服务端只回 items，
 * 所以这里不做往前翻页，只在「跟随」打开时定时重取最新一页（见 modules/observability 的 logs 路由）。
 */
export function useLogFeed(projectId: string, selected: OperationsSearch, onChange: (next: OperationsSearch) => void): LogFeed {
  const [text, setText] = useState('');
  const filters: LogFilterValues = { source: selected.source ?? 'slot', slot: selected.slot === 'all' ? '' : selected.slot ?? 'prod', limit: selected.limit ?? 200, text, taskId: selected.taskId, releaseId: selected.releaseId, since: selected.since };
  const [follow, setFollow] = useState(true);
  const enabled = projectId !== '';
  const request: LogQueryInput = {
    source: filters.source,
    slot: filters.source === 'slot' && filters.slot !== '' ? filters.slot : undefined,
    limit: filters.limit,
    taskId: TaskIdSchema.safeParse(filters.taskId).data,
    releaseId: filters.releaseId,
    since: filters.since,
  };
  const query = useApiQuery([...queryKeys.logs(projectId), request], () => api.observability.logs(projectId, request), { enabled });
  usePollingRefetch(query.refetch, FOLLOW_POLL_MS, enabled && follow);

  const items = query.data?.items;
  const needle = filters.text.trim().toLowerCase();
  // ISO 时间串按字典序即按时间序，最新的排在最后，跟随时滚到底就是最新一条。
  const entries = useMemo(() => {
    const page = items ?? [];
    const matched = needle === '' ? page : page.filter((entry) => entry.message.toLowerCase().includes(needle));
    return [...matched].sort((left, right) => left.ts.localeCompare(right.ts));
  }, [items, needle]);

  const changeFilters = useCallback((next: LogFilterValues) => {
    setText(next.text);
    onChange({ source: next.source, slot: next.slot === '' ? 'all' : next.slot, limit: next.limit, taskId: next.taskId, releaseId: next.releaseId, since: next.since });
  }, [onChange]);

  return {
    filters,
    changeFilters,
    entries,
    total: items?.length ?? 0,
    isPending: query.isPending,
    error: query.error,
    follow,
    changeFollow: setFollow,
  };
}
