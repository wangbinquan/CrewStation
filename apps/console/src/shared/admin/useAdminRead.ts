import { useCallback } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useApiQuery } from '../api/useApi';
import { usePollingRefetch } from '../lib/usePollingRefetch';

/** 管理查询按当前账号缓存；是否周期刷新由具体页面决定。 */
export function useAdminPage<T>(key: QueryKey, read: () => Promise<T>, enabled = true) {
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const allowed = !me.error && me.data?.isAdmin === true;
  const query = useApiQuery([...key, { viewerId: me.data?.id }], read, { enabled: allowed && enabled, staleTimeMs: 0, refetchOnWindowFocus: false });
  return { query, me, allowed, busy: me.isFetching || query.isFetching };
}

/**
 * 只读管理摘要：每 30 秒先核对身份再静默重读，界面不进入重读状态；不提供刷新按钮（2026-09-23 裁定）。
 * 不用于保存编辑器草稿的页面。
 */
export function useAdminRead<T>(key: QueryKey, read: () => Promise<T>) {
  const { query, me, allowed } = useAdminPage(key, read);
  const { refetch: readIdentity } = me, { refetch: readPage } = query, userId = me.data?.id;
  const reread = useCallback(async () => {
    const current = await readIdentity({ cancelRefetch: false });
    if (!current.error && current.data?.isAdmin && current.data.id === userId) await readPage({ cancelRefetch: false });
  }, [readIdentity, userId, readPage]);
  usePollingRefetch(reread, 30_000, allowed);
  return { query, userId: me.data?.id };
}
