import { useEffect } from 'react';

/**
 * 页面停留期间按固定间隔重取：投递、发布、日志都由后台异步推进，工作台不订阅推送，只能轮询。
 * enabled 为 false 或间隔非正时不建定时器；条件不再成立（例如全部进入终态）就停，避免空转。
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
