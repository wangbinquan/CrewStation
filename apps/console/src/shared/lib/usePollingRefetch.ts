import { useEffect } from 'react';

/**
 * 页面停留期间按固定间隔重取：投递、发布、日志都由后台异步推进，工作台不订阅推送，只能轮询。
 * 后台暂停，返回前台补查；enabled 为 false 或间隔非正时不建定时器。
 */
export function usePollingRefetch(refetch: () => unknown, intervalMs: number, enabled = true): void {
  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = (refresh: boolean) => {
      if (timer) clearInterval(timer); timer = undefined;
      if (document.visibilityState === 'hidden') return;
      if (refresh) refetch();
      timer = setInterval(refetch, intervalMs);
    };
    const visibility = () => sync(true);
    sync(false); document.addEventListener('visibilitychange', visibility);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [refetch, intervalMs, enabled]);
}
