import type { DeliveryDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useI18n } from '../../../shared/lib/useI18n';
import { formatDateTime } from '../../../shared/lib/dateFormat';
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
}

/** 一条投递记录；失败的把最后一次错误折到下一行，避免长错误把表格横向撑开。 */
export function DeliveryRow({ delivery, canReplay, isReplaying, onReplay }: DeliveryRowProps): ReactElement {
  const t = useT();
  const { locale } = useI18n();
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
        <td className={styles.trace}>{delivery.traceId}</td>
        <td className={styles.time}>{delivery.deliveredAt === undefined ? t('events.none') : formatDateTime(delivery.deliveredAt, locale)}</td>
        <td className={styles.time}>{delivery.nextAttemptAt === undefined ? t('events.none') : formatDateTime(delivery.nextAttemptAt, locale)}</td>
        <td>
          {delivery.state === 'dead' ? (
            <Button disabled={!replayable || isReplaying} title={replayable ? undefined : t('events.deliveries.replayHint')} onClick={() => onReplay(delivery.id)}>
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
