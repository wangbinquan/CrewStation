import { useCallback, useState } from 'react';
import { usePollingRefetch } from './usePollingRefetch';

/**
 * 把「用户点了刷新」和「后台例行重读」分开：只有前者让界面进入重读状态（禁用入口、按钮显示忙），
 * 后台重读不动界面，数据到达后原地替换。
 *
 * 之前两者共用 `isFetching`，每一轮轮询都会把入口链接换成纯文本、横幅抽走再放回，
 * 表现为界面定期闪一下（2026-09-21 实机，作者当面裁定：自动重读不改界面）。
 */
export function useManualRefresh<T>(reread: () => Promise<T>): { readonly refresh: () => Promise<T>; readonly refreshing: boolean } {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { return await reread(); } finally { setRefreshing(false); }
  }, [reread]);
  return { refresh, refreshing };
}

/**
 * 例行轮询与手动刷新的标准组合：轮询静默重取，只有用户点的刷新才抬 `refreshing`。
 * 页面据此决定禁用哪些入口——背景重取不该让按钮每几秒变灰一次。
 */
export function usePolledRefresh<T>(refetch: () => Promise<T>, intervalMs: number, enabled = true): { readonly refresh: () => Promise<T>; readonly refreshing: boolean } {
  const { refresh, refreshing } = useManualRefresh(refetch);
  usePollingRefetch(refetch, intervalMs, enabled);
  return { refresh, refreshing };
}
