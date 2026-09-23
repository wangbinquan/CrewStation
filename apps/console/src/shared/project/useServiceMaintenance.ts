import type { MaintenanceDto, MaintenanceEventDto } from '@crewstation/contracts';
import { api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useApiQuery } from '../api/useApi';

/** 维护会被别人进入或退出，页面停留时按这个间隔重读。 */
const MAINTENANCE_POLL_MS = 30_000;

/**
 * 正式版本的维护状态与记录（RFC-021）：发布页与概览共用一份缓存。读不到时 `current` 为 undefined（不猜「没在维护」），
 * 读到且不在维护时为 null。
 */
export function useServiceMaintenance(serviceId: string | undefined) {
  const query = useApiQuery(queryKeys.maintenance(serviceId ?? ''), () => api.services.getMaintenance(serviceId!), { enabled: !!serviceId, refetchIntervalMs: MAINTENANCE_POLL_MS });
  const known = !!query.data && !query.error;
  const current: MaintenanceDto | null | undefined = known ? query.data!.current ?? null : undefined;
  const history: readonly MaintenanceEventDto[] = known ? query.data!.history ?? [] : [];
  return { query, current, history };
}
