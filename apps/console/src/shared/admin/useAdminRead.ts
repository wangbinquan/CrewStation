import { useCallback } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useApiQuery } from '../api/useApi';
import { usePollingRefetch } from '../lib/usePollingRefetch';

/**
 * 管理查询按当前账号缓存。`poll` 为真时每 30 秒先核对身份、仍是同一位管理员才静默重读；不提供刷新按钮（2026-09-23 裁定）。
 * `loading` 只算首次读取与换页（查询键变了），用来禁用入口；例行重读不算，否则入口每 30 秒变灰一次。
 */
export function useAdminPage<T>(key: QueryKey, read: () => Promise<T>, enabled = true, poll = false) {
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const allowed = !me.error && me.data?.isAdmin === true;
  const query = useApiQuery([...key, { viewerId: me.data?.id }], read, { enabled: allowed && enabled, staleTimeMs: 0, refetchOnWindowFocus: false });
  const { refetch: readIdentity } = me, { refetch: readPage } = query, userId = me.data?.id;
  const reread = useCallback(async () => {
    const current = await readIdentity({ cancelRefetch: false });
    if (!current.error && current.data?.isAdmin && current.data.id === userId) await readPage({ cancelRefetch: false });
  }, [readIdentity, userId, readPage]);
  usePollingRefetch(reread, 30_000, poll && allowed && enabled);
  return { query, me, allowed, loading: me.isPending || allowed && enabled && query.isPending };
}

/** 只读管理摘要：定期静默重读（见 useAdminPage 的 `poll`）。不用于保存编辑器草稿的页面。 */
export function useAdminRead<T>(key: QueryKey, read: () => Promise<T>) {
  const { query, me } = useAdminPage(key, read, true, true);
  return { query, userId: me.data?.id };
}
