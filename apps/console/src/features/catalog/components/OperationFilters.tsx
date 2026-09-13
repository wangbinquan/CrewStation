import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import styles from './OperationsPanel.module.css';

export type GrantFilter = 'all' | 'granted' | 'not-granted';

export interface OperationFilterValue {
  readonly proxy: string;
  readonly grant: GrantFilter;
}

export const ALL_PROXIES = '';

export interface OperationFiltersProps {
  readonly value: OperationFilterValue;
  readonly proxies: readonly string[];
  readonly count: number;
  readonly onChange: (value: OperationFilterValue) => void;
  readonly showGrant?: boolean;
}

/** 代理与授权两个筛选条件；筛选只作用于已取回的列表，不改变请求。 */
export function OperationFilters({ value, proxies, count, onChange, showGrant = true }: OperationFiltersProps): ReactElement {
  const t = useT();
  return (
    <div className={styles.filters}>
      <label className={styles.filter}>
        <span className={styles.filterLabel}>{t('catalog.filters.proxy')}</span>
        <select className={styles.select} value={value.proxy} onChange={(e) => onChange({ ...value, proxy: e.target.value })}>
          <option value={ALL_PROXIES}>{t('catalog.filters.allProxies')}</option>
          {proxies.map((proxy) => (
            <option key={proxy} value={proxy}>
              {proxy}
            </option>
          ))}
        </select>
      </label>
      {showGrant ? <label className={styles.filter}>
        <span className={styles.filterLabel}>{t('catalog.filters.grant')}</span>
        <select className={styles.select} value={value.grant} onChange={(e) => onChange({ ...value, grant: e.target.value as GrantFilter })}>
          <option value="all">{t('catalog.filters.allGrants')}</option>
          <option value="granted">{t('catalog.filters.grantedOnly')}</option>
          <option value="not-granted">{t('catalog.filters.notGranted')}</option>
        </select>
      </label> : null}
      <span className={styles.count}>{t('catalog.filters.count', { count })}</span>
    </div>
  );
}
