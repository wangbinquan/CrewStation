import { useT } from '../../lib/useT';
import { catalogHistory } from '../../lib/catalogHistory';
import { Button } from '../Button';
import { ActionRow } from '../ActionRow';
import styles from '../CapabilityCatalog.module.css';

export function CatalogPagination({ scope, userId, filter, cursor, next, count, disabled, onChange }: {
  readonly scope: string; readonly userId?: string; readonly filter: unknown; readonly cursor?: string; readonly next?: string;
  readonly count?: number; readonly disabled?: boolean; readonly onChange: (cursor?: string) => void;
}) {
  const t = useT(), history = catalogHistory(scope, userId, filter, cursor);
  return <div className={styles.pagination}><span className={styles.hint}>{count === undefined ? t('catalog.countUnknown') : t('catalog.pageCount', { count })}</span><ActionRow>
    {cursor ? <Button disabled={disabled} onClick={() => onChange(history.previous || undefined)}>{t(history.previous === undefined ? 'catalog.first' : 'catalog.previous')}</Button> : null}
    <Button disabled={disabled || !next} onClick={() => { if (next) { history.remember(next); onChange(next); } }}>{t('catalog.next')}</Button>
  </ActionRow></div>;
}
