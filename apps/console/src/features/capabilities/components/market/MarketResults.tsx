import { useState } from 'react';
import type { MarketAppDto } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { DataTable } from '../../../../shared/ui/DataTable';
import { MarketAppRow } from './MarketAppRow';
import { MarketAppDetails } from './MarketAppDetails';
import styles from './Market.module.css';

export function MarketResults({ items, onOwner }: { readonly items: MarketAppDto[]; readonly onOwner: (app: MarketAppDto) => void }) {
  const t = useT(), [selected, setSelected] = useState<string>();
  const app = items.find((item) => item.projectId === selected);
  // 撤权／移出当前结果时彻底关闭；后来重新可见不能自行重开旧详情。
  if (selected && !app) setSelected(undefined);
  return <>
    <p className={styles.count} aria-live="polite">{t('market.pageCount', { count: items.length })}</p>
    {items.length ? <DataTable className={styles.table} columns={[t('market.capability'), t('market.owner'), t('market.status'), t('market.actions')]}>
      {items.map((item) => <MarketAppRow key={item.projectId} app={item} onOwner={onOwner} onDetails={() => setSelected(item.projectId)} />)}
    </DataTable> : null}
    {app ? <MarketAppDetails app={app} onClose={() => setSelected(undefined)} /> : null}
  </>;
}
