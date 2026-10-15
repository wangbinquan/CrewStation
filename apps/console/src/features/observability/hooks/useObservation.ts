import type { QueryKey } from '@tanstack/react-query';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import type { ObservationWindow, RuntimePeriod } from '../model/runtimeSearch';
import { observationWindow } from '../model/runtimeSearch';

/**
 * RFC-034 v2 §5：统计按需聚合，每 30 秒在原位重读。窗口终点取每次读取的当时，所以自动刷新带来新执行；
 * 查询键只含时间范围的档位，切换档位才换数据。
 */
export function useObservation<T>(key: QueryKey, period: RuntimePeriod, read: (window: ObservationWindow) => Promise<T>, enabled = true) {
  return useApiQuery(['runtime-observation', ...key, period], () => read(observationWindow(period, Date.now())), { ...AUTO_REFRESH, enabled });
}
