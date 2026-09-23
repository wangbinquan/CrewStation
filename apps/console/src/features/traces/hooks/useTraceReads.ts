import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import type { ItemsPage } from '@crewstation/api-client';
import type { TraceEventDto, TraceSummaryDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import type { ApiClientError } from '../../../shared/api/useApi';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import type { TraceFilters } from '../model/traceView';

/** 列表每页条数；服务端一页没找够却给了游标，说明扫到了轮数上限（见 TraceListCard）。 */
export const TRACE_PAGE_SIZE = 50;

/** 调用链的查询键都挂在项目下，换项目时互不串用。 */
export const traceKeys = {
  list: (projectId: string, filters: TraceFilters) => ['traces', projectId, 'list', filters.source ?? 'all', filters.status ?? 'all', filters.window] as const,
  chain: (projectId: string, traceId: string) => ['traces', projectId, 'chain', traceId] as const,
  events: (projectId: string, traceId: string, taskId: string) => ['traces', projectId, 'events', traceId, taskId] as const,
};

/**
 * 列表按页追加（「加载更多」）；页面数据每 30 秒原位重读（AUTO_REFRESH），已加载的几页按新的游标依次重取。
 * 换筛选时先留住上一份列表，新结果到了再替换，不整块卸载。
 */
export function useTraceList(projectId: string, filters: TraceFilters) {
  return useInfiniteQuery<ItemsPage<TraceSummaryDto>, ApiClientError, InfiniteData<ItemsPage<TraceSummaryDto>, string | undefined>, readonly unknown[], string | undefined>({
    queryKey: traceKeys.list(projectId, filters),
    queryFn: ({ pageParam }) => api.traces.list(projectId, { ...(filters.source ? { source: filters.source } : {}), ...(filters.status ? { status: filters.status } : {}), window: filters.window, limit: TRACE_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    refetchInterval: AUTO_REFRESH.refetchIntervalMs, refetchIntervalInBackground: false, refetchOnWindowFocus: AUTO_REFRESH.refetchOnWindowFocus,
  });
}

/** 一条链的分层回放：进行中的链跟着页面每 30 秒重读。 */
export function useTraceChain(projectId: string, traceId: string | undefined) {
  return useApiQuery(traceKeys.chain(projectId, traceId ?? ''), () => api.traces.get(projectId, traceId!), { enabled: Boolean(traceId), ...AUTO_REFRESH });
}

/** 一个执行的事件：按序号往后翻，展开时才读。 */
export function useTraceEvents(projectId: string, traceId: string, taskId: string, enabled: boolean) {
  return useInfiniteQuery<ItemsPage<TraceEventDto>, ApiClientError, InfiniteData<ItemsPage<TraceEventDto>, string | undefined>, readonly unknown[], string | undefined>({
    queryKey: traceKeys.events(projectId, traceId, taskId),
    queryFn: ({ pageParam }) => api.traces.events(projectId, traceId, taskId, { limit: 100, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    refetchInterval: AUTO_REFRESH.refetchIntervalMs, refetchIntervalInBackground: false,
  });
}

/** 创建人的名字：项目成员加上自己；查不到的由调用方显示短 ID。 */
export function useUserNames(projectId: string): ReadonlyMap<string, string> {
  const members = useApiQuery(queryKeys.members(projectId), () => api.projects.listMembers(projectId));
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const names = new Map<string, string>();
  for (const member of members.data?.items ?? []) names.set(member.userId, member.name);
  if (me.data) names.set(me.data.id, me.data.name);
  return names;
}
