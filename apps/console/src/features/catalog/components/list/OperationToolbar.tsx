import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { ALL_PROVIDERS, PLATFORM_PROVIDER } from './operationSections';
import type { OperationListFilter, StatusFilter } from './operationSections';
import styles from './OperationList.module.css';

/** 一行筛选：搜索占满余下宽度，提供方与状态两个下拉，窄时整体折行。 */
export function OperationToolbar({ value, providers, platform, count, onChange }: { readonly value: OperationListFilter; readonly providers: readonly { id: string; name: string }[]; readonly platform: boolean; readonly count: number; readonly onChange: (value: OperationListFilter) => void }): ReactElement {
  const t = useT();
  return <div className={styles.toolbar}>
    <input type="search" className={styles.search} value={value.text} placeholder={t('catalog.list.search')} aria-label={t('catalog.list.search')} onChange={(event) => onChange({ ...value, text: event.target.value })} />
    <select className={styles.select} aria-label={t('catalog.list.provider')} value={value.provider} onChange={(event) => onChange({ ...value, provider: event.target.value })}>
      <option value={ALL_PROVIDERS}>{t('catalog.list.allProviders')}</option>
      {platform ? <option value={PLATFORM_PROVIDER}>{t('catalog.list.platformProvider')}</option> : null}
      {providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    <select className={styles.select} aria-label={t('catalog.list.statusFilter')} value={value.status} onChange={(event) => onChange({ ...value, status: event.target.value as StatusFilter })}>
      {(['all', 'callable', 'request'] as const).map((item) => <option key={item} value={item}>{t(`catalog.list.statusFilter.${item}`)}</option>)}
    </select>
    <span className={styles.count}>{t('catalog.list.count', { count })}</span>
  </div>;
}
