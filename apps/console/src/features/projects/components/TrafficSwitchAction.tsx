import type { SlotDto, SlotName } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { InlineConfirm } from '../../../shared/ui/InlineConfirm';
import styles from './TrafficSwitchAction.module.css';

export interface TrafficSwitchActionProps {
  readonly serviceId: string;
  readonly slots: readonly SlotDto[];
}

/** 切流：把用户域流量切到待机槽，回滚就是再切回来；两段式确认由 InlineConfirm 提供。 */
export function TrafficSwitchAction({ serviceId, slots }: TrafficSwitchActionProps): ReactElement | null {
  const t = useT();
  const active = slots.find((slot) => slot.active);
  const target = slots.find((slot) => !slot.active);
  // 带上页面上看到的在线 Release：期间别人已经切过时服务端拒绝，而不是覆盖对方的切流。
  const switchTraffic = useApiMutation((toSlot: SlotName) => api.services.switchTraffic(serviceId, { toSlot, expectedActiveRelease: active?.releaseId }), {
    invalidate: [queryKeys.slots(serviceId), queryKeys.trafficSwitches(serviceId)],
  });
  if (target === undefined) return null;
  return (
    <div className={styles.action}>
      <InlineConfirm
        variant="primary"
        label={t('projects.switch.action', { slot: target.name })}
        question={t('projects.switch.confirmQuestion', { from: active?.name ?? '—', to: target.name })}
        confirmLabel={t('projects.switch.confirm')}
        busy={switchTraffic.isPending}
        busyLabel={t('projects.switch.pending')}
        onConfirm={() => switchTraffic.mutate(target.name)}
      />
      {switchTraffic.isError ? <ActionNote tone="error">{t('projects.switch.error', { message: errorMessage(switchTraffic.error) })}</ActionNote> : null}
      {switchTraffic.isSuccess ? <ActionNote tone="success">{t('projects.switch.done', { slot: switchTraffic.data.toSlot })}</ActionNote> : null}
    </div>
  );
}
