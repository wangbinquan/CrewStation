import { useState } from 'react';
import type { MarketSearch } from '../../model/marketSearch';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { FormField } from '../../../../shared/ui/FormField';
import styles from './Market.module.css';

export function MarketToolbar({ search, onChange }: { readonly search: MarketSearch; readonly onChange: (next: MarketSearch) => void }) {
  const t = useT(), [input, setInput] = useState(search.q ?? '');
  return <form className={styles.search} onSubmit={(event) => { event.preventDefault(); onChange({ ...search, q: input.trim(), cursor: undefined }); }}>
    <FormField label={t('market.search')}><input value={input} maxLength={120} placeholder={t('market.placeholder')} onChange={(event) => setInput(event.target.value)} /></FormField>
    <Button type="submit" variant="primary">{t('market.searchAction')}</Button>
    <FormField label={t('market.pageSize')}><select value={search.limit ?? 20} onChange={(event) => onChange({ ...search, limit: Number(event.target.value), cursor: undefined })}>
      <option value={20}>20</option><option value={50}>50</option>
    </select></FormField>
    {search.ownerId ? <Button onClick={() => onChange({ ...search, ownerId: undefined, ownerName: undefined, cursor: undefined })} aria-label={t('market.clearOwner')}>
      {t('market.ownerFilter', { name: search.ownerName || t('market.selectedOwner') })} ×
    </Button> : null}
    {search.q || search.ownerId || search.cursor ? <Button onClick={() => onChange({ limit: search.limit })}>{t('market.reset')}</Button> : null}
  </form>;
}
