import type { SlotDto, SlotName } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { ActionNote } from './ActionNote';
import styles from './TrafficSwitchAction.module.css';

export interface TrafficSwitchActionProps {
  readonly serviceId: string;
  readonly slots: readonly SlotDto[];
}

/**
 * 切流：把用户域流量切到待机槽，回滚就是再切回来。
 * 确认步骤做成页面内的一步，不用 window.confirm——浏览器原生弹窗会卡住自动化调试。
 */
export function TrafficSwitchAction({ serviceId, slots }: TrafficSwitchActionProps): ReactElement | null {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const active = slots.find((slot) => slot.active);
  const target = slots.find((slot) => !slot.active);
  // 带上页面上看到的在线 Release：期间别人已经切过时服务端拒绝，而不是覆盖对方的切流。
  const switchTraffic = useApiMutation(
    (toSlot: SlotName) => api.services.switchTraffic(serviceId, { toSlot, expectedActiveRelease: active?.releaseId }),
    { invalidate: [queryKeys.slots(serviceId), queryKeys.trafficSwitches(serviceId)], onSuccess: () => setConfirming(false) },
  );
  if (target === undefined) return null;
  return (
    <div className={styles.action}>
      {confirming ? (
        <div className={styles.confirm} role="group">
          <p>{t('projects.switch.confirmQuestion', { from: active?.name ?? '—', to: target.name })}</p>
          <div className={styles.buttons}>
            <Button variant="primary" disabled={switchTraffic.isPending} onClick={() => switchTraffic.mutate(target.name)}>
              {switchTraffic.isPending ? t('projects.switch.pending') : t('projects.switch.confirm')}
            </Button>
            <Button onClick={() => setConfirming(false)}>{t('projects.switch.cancel')}</Button>
          </div>
        </div>
      ) : (
        <Button variant="primary" onClick={() => setConfirming(true)}>
          {t('projects.switch.action', { slot: target.name })}
        </Button>
      )}
      {switchTraffic.isError ? <ActionNote tone="error">{t('projects.switch.error', { message: errorMessage(switchTraffic.error) })}</ActionNote> : null}
      {switchTraffic.isSuccess ? <ActionNote tone="success">{t('projects.switch.done', { slot: switchTraffic.data.toSlot })}</ActionNote> : null}
    </div>
  );
}
