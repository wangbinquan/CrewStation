import type { DeliveryDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { DeliveryStateBadge } from './DeliveryStateBadge';
import styles from './DeliveryRow.module.css';

export interface DeliveryRowProps {
  readonly delivery: DeliveryDto;
  /** 只有项目负责人（或平台管理员）能把死信重新入队。 */
  readonly canReplay: boolean;
  readonly isReplaying: boolean;
  readonly onReplay: (deliveryId: string) => void;
  readonly onTrace?: (traceId: string) => void;
}

/** 一条投递记录；失败的把最后一次错误折到下一行，避免长错误把表格横向撑开。 */
export function DeliveryRow({ delivery, canReplay, isReplaying, onReplay, onTrace }: DeliveryRowProps): ReactElement {
  const t = useT();
  const dateText = useDateText();
  const replayable = canReplay && delivery.state === 'dead';
  return (
    <>
      <tr>
        <td>
          <code>{delivery.eventType}</code>
        </td>
        <td>
          <DeliveryStateBadge state={delivery.state} />
        </td>
        <td className={styles.attempts}>{delivery.attempts}</td>
        <td className={styles.trace}>{onTrace ? <Button variant="ghost" size="small" onClick={() => onTrace(delivery.traceId)}>{delivery.traceId}</Button> : delivery.traceId}</td>
        <td className={styles.time}>{dateText(delivery.deliveredAt)}</td>
        <td className={styles.time}>{dateText(delivery.nextAttemptAt)}</td>
        <td>
          {delivery.state === 'dead' ? (
            <Button size="small" disabled={!replayable || isReplaying} title={replayable ? undefined : t('events.deliveries.replayHint')} onClick={() => onReplay(delivery.id)}>
              {isReplaying ? t('events.deliveries.replaying') : t('events.deliveries.replay')}
            </Button>
          ) : (
            t('events.none')
          )}
        </td>
      </tr>
      {delivery.lastError === undefined ? null : (
        <tr>
          <td className={styles.errorCell} colSpan={7}>
            <span className={styles.errorLabel}>{t('events.deliveries.lastError')}</span>
            <span className={styles.errorText}>{delivery.lastError}</span>
          </td>
        </tr>
      )}
    </>
  );
}
