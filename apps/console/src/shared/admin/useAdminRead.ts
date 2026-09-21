import { useCallback } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useApiQuery } from '../api/useApi';
import { useManualRefresh } from '../lib/useManualRefresh';
import { usePollingRefetch } from '../lib/usePollingRefetch';

/** 管理查询按当前账号缓存；是否周期刷新由具体页面决定。 */
export function useAdminPage<T>(key: QueryKey, read: () => Promise<T>, enabled = true) {
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const allowed = !me.error && me.data?.isAdmin === true;
  const query = useApiQuery([...key, { viewerId: me.data?.id }], read, { enabled: allowed && enabled, staleTimeMs: 0, refetchOnWindowFocus: false });
  return { query, me, allowed, busy: me.isFetching || query.isFetching };
}

/**
 * 只读管理摘要在前台核对身份并刷新；不用于保存编辑器草稿的页面。
 * 例行重读静默进行，只有用户点的刷新才把 `refreshing` 抬起来，否则每 30 秒都要闪一次入口。
 */
export function useAdminRead<T>(key: QueryKey, read: () => Promise<T>) {
  const { query, me, allowed } = useAdminPage(key, read);
  const { refetch: readIdentity } = me, { refetch: readPage } = query, userId = me.data?.id;
  const reread = useCallback(async () => {
    const current = await readIdentity({ cancelRefetch: false });
    if (!current.error && current.data?.isAdmin && current.data.id === userId) await readPage({ cancelRefetch: false });
  }, [readIdentity, userId, readPage]);
  const { refresh, refreshing } = useManualRefresh(reread);
  usePollingRefetch(reread, 30_000, allowed);
  return { query, refresh, userId: me.data?.id, refreshing };
}
