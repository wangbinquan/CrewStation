import { useT } from '../lib/useT';
import { useDateText } from '../lib/useDateText';
import { Button } from '../ui/Button';
import styles from './RequestPageControls.module.css';

export function RequestPageControls({ scope, count, cursor, nextCursor, busy, updatedAt, onPage }: {
  readonly scope: string; readonly count?: number; readonly cursor?: string; readonly nextCursor?: string; readonly busy: boolean;
  readonly updatedAt: number; readonly onPage: (cursor?: string) => void;
}) {
  const t = useT(), dateText = useDateText();
  return <div className={styles.bar} aria-label={t('ui.requestPage.label', { scope })}>
    <span>{count === undefined ? t('ui.requestPage.unknown') : t('ui.requestPage.count', { count })}
      {count !== undefined && updatedAt > 0 ? <span className={styles.time}> · {t('ui.requestPage.updated', { time: dateText(new Date(updatedAt).toISOString()) })}</span> : null}</span>
    <div className={styles.actions}>{cursor ? <Button disabled={busy} onClick={() => onPage()}>{t('ui.requestPage.first')}</Button> : null}
      <Button aria-label={t('ui.requestPage.nextFor', { scope })} disabled={busy || count === undefined || !nextCursor} onClick={() => onPage(nextCursor)}>{t('ui.requestPage.next')}</Button></div>
  </div>;
}
