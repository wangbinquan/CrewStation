import { useEffect } from 'react';

/**
 * 在条件成立期间定时重取。
 * 发布是异步流水线，工作台没有推送通道，构建／迁移／部署期间只能轮询；
 * 全部进入终态后停止，避免空转。
 */
export function useIntervalRefetch(active: boolean, refetch: () => void, intervalMs = 5_000): void {
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(refetch, intervalMs);
    return () => clearInterval(timer);
  }, [active, refetch, intervalMs]);
}
