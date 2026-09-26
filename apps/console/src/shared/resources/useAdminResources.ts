import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useApiQuery } from '../api/useApi';
import { retainProjectResources } from './projectResourceStreams';

/** 管理员全平台视图：一份快照、一条推送流；项目展开时只过滤记录，不另开项目连接。 */
export function useAdminResources(enabled = true) {
  const client = useQueryClient();
  const query = useApiQuery(queryKeys.adminResources(), () => api.resources.adminView(), { enabled, staleTimeMs: Number.POSITIVE_INFINITY, refetchOnWindowFocus: false });
  const live = enabled && query.status === 'success';
  useEffect(() => {
    if (!live) return;
    const EventSourceImpl = (globalThis as { EventSource?: new (url: string) => EventSource }).EventSource;
    return retainProjectResources(client, 'admin', {
      queryKey: queryKeys.adminResources(), view: () => api.resources.adminView(),
      streamUrl: (_scope, cursor) => api.resources.adminStreamUrl({ cursor }),
      ...(EventSourceImpl ? { open: (url: string) => new EventSourceImpl(url) } : {}),
    });
  }, [client, live]);
  return query;
}
