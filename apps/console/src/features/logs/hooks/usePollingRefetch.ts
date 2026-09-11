import { useEffect } from 'react';

/**
 * 页面停留期间按固定间隔重取；“跟随”关闭或在翻历史页时传 enabled=false，避免把用户拉回最新一页。
 * 定时器随 effect 清理，离开页面后不再发请求。
 */
export function usePollingRefetch(refetch: () => unknown, intervalMs: number, enabled = true): void {
  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    const timer = setInterval(() => {
      refetch();
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [refetch, intervalMs, enabled]);
}
