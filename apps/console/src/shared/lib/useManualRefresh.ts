import { useCallback, useState } from 'react';

/**
 * 把「显式重读」（例如保存后立刻核对一次）和「后台例行重读」分开：只有前者让界面进入重读状态（禁用入口、显示忙），
 * 后台重读不动界面，数据到达后原地替换。页面上没有刷新按钮（2026-09-23 裁定：页面自动局部刷新）。
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
