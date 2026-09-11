import type { DeliveryState } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import styles from './DeliveryStateFilter.module.css';

/** 空串表示不过滤；顺序按投递推进的先后。 */
export const DELIVERY_STATES: readonly DeliveryState[] = ['pending', 'delivering', 'delivered', 'retrying', 'dead'];

export interface DeliveryStateFilterProps {
  readonly value: DeliveryState | '';
  readonly onChange: (value: DeliveryState | '') => void;
}

export function DeliveryStateFilter({ value, onChange }: DeliveryStateFilterProps): ReactElement {
  const t = useT();
  return (
    <>
      <span className={styles.refresh}>{t('events.deliveries.autoRefresh')}</span>
      <label className={styles.filter}>
        {t('events.deliveries.filterLabel')}
        <select className={styles.select} value={value} onChange={(event) => onChange(event.target.value as DeliveryState | '')}>
          <option value="">{t('events.deliveries.filterAll')}</option>
          {DELIVERY_STATES.map((state) => (
            <option key={state} value={state}>
              {t(`events.deliveryState.${state}`)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
