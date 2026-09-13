import { useCallback } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useApiQuery } from '../api/useApi';
import { usePollingRefetch } from '../lib/usePollingRefetch';

/** 只读管理摘要：按账号隔离缓存，前台刷新时先核对身份；不用于保存编辑器草稿的页面。 */
export function useAdminRead<T>(key: QueryKey, read: () => Promise<T>) {
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const allowed = !me.error && me.data?.isAdmin === true;
  const query = useApiQuery([...key, { viewerId: me.data?.id }], read, { enabled: allowed, staleTimeMs: 0, refetchOnWindowFocus: false });
  const refresh = useCallback(async () => {
    const current = await me.refetch({ cancelRefetch: false });
    if (!current.error && current.data?.isAdmin && current.data.id === me.data?.id) await query.refetch({ cancelRefetch: false });
  }, [me.refetch, me.data?.id, query.refetch]);
  usePollingRefetch(refresh, 30_000, allowed);
  return { query, refresh, userId: me.data?.id, busy: me.isFetching || query.isFetching };
}
