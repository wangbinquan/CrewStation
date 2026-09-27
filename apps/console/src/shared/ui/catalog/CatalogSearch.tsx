import { useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../../lib/useT';
import { Button } from '../Button';
import { FormField } from '../FormField';
import styles from '../CapabilityCatalog.module.css';

export function CatalogSearch({ value, label, onSearch, children, actions }: { readonly value: string; readonly label: string; readonly onSearch: (value: string) => void; readonly children?: ReactNode; readonly actions?: ReactNode }) {
  const t = useT(), [draft, setDraft] = useState(value);
  return <form role="search" className={styles.listToolbar} onSubmit={(event) => { event.preventDefault(); onSearch(draft.trim()); }}>
    <FormField label={label}><input type="search" maxLength={120} value={draft} onChange={(event) => setDraft(event.target.value)} /></FormField>
    {children}<Button type="submit">{t('catalog.search')}</Button>
    {value ? <Button onClick={() => { setDraft(''); onSearch(''); }}>{t('catalog.clear')}</Button> : null}
    {actions ? <div className={styles.toolbarActions}>{actions}</div> : null}
  </form>;
}
