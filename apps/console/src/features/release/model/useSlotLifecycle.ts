import { useState } from 'react';
import type { ReleaseDto, SlotDto, SlotRetentionDto } from '@crewstation/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage } from '../../../shared/api/useApi';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import type { ReleaseActions } from './useReleaseActions';

export type LifecycleAction = 'offline' | 'postpone' | 'redeploy';

/**
 * RFC-021：待验证版本的下线、推迟，和从发布记录重新部署。每个请求都带上页面上看到的确认值（待命版本、到期时间、
 * 待命槽上的版本），页面停留期间别人先动过时服务端拒绝，而不是悄悄覆盖；成功或失败都重读槽与记录，让页面回到事实。
 */
export function useSlotLifecycle(projectId: string, serviceId: string, actions: ReleaseActions) {
  const t = useT(), date = useDateText(), client = useQueryClient();
  const [pending, setPending] = useState<LifecycleAction>(), [error, setError] = useState<string>(), [done, setDone] = useState<string>();
  const refresh = () => Promise.all([queryKeys.slots(serviceId), queryKeys.releases(serviceId), queryKeys.slotEvents(serviceId), ['releases'], ['projects', projectId, 'summary']]
    .map((queryKey) => client.invalidateQueries({ queryKey })));
  const run = async (action: LifecycleAction, request: () => Promise<string>): Promise<boolean> => {
    if (!actions.begin('lifecycle')) return false;
    setPending(action); setError(undefined); setDone(undefined);
    try { setDone(await request()); return true; }
    catch (cause) { setError(errorMessage(cause)); return false; }
    finally { await refresh(); setPending(undefined); actions.finish('lifecycle'); }
  };
  return {
    pending, error, done,
    takeOffline: (slot: SlotDto) => run('offline', async () => {
      await api.services.takeOffline(serviceId, { expectedReleaseId: slot.releaseId! });
      return t('release.lifecycle.offlineDone', { tag: slot.tag ?? '' });
    }),
    postpone: (slot: SlotDto) => run('postpone', async () => {
      const items = (await api.services.postponeOffline(serviceId, { expectedDeadline: slot.retention!.deadline })).items;
      return t('release.lifecycle.postponeDone', { tag: slot.tag ?? '', time: date(items.find((item) => item.name === 'preview')?.retention?.deadline) });
    }),
    redeploy: (release: ReleaseDto, standby: SlotDto | undefined) => run('redeploy', async () => {
      await api.services.redeploy(release.id, { expectedStandbyReleaseId: standby?.releaseId ?? null });
      return t('release.redeploy.done', { tag: release.tag });
    }),
  };
}
export type SlotLifecycle = ReturnType<typeof useSlotLifecycle>;

/** 一个周期的文案，单位跟平台设置一致：回退目标按小时（默认 72 小时），无人访问按天（默认 14 天）。 */
export function periodText(retention: Pick<SlotRetentionDto, 'kind' | 'periodHours'>): { readonly unit: 'days' | 'hours'; readonly count: number } {
  return retention.kind === 'pending' ? { unit: 'days', count: Math.round(retention.periodHours / 24) } : { unit: 'hours', count: retention.periodHours };
}
