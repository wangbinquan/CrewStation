import type { RequestDraft } from './useRequestDrafts';
import { useT } from '../lib/useT';
import { Button } from '../ui/Button';
import styles from './RequestDraftNotice.module.css';

export function RequestDraftNotice({ drafts, pendingIds, busy, onDiscard }: {
  readonly drafts: readonly RequestDraft[]; readonly pendingIds: readonly string[]; readonly busy: boolean; readonly onDiscard: (id: string) => void;
}) {
  const t = useT(), orphaned = drafts.filter((draft) => !pendingIds.includes(draft.id));
  if (orphaned.length === 0) return null;
  return <section className={styles.notice} aria-label={t('ui.requestDraft.title')}>
    <h3>{t('ui.requestDraft.title')}</h3><p>{t('ui.requestDraft.hint')}</p>
    {orphaned.map((draft) => <div className={styles.draft} key={draft.id}><strong>{draft.label}</strong><code>{draft.id}</code>
      <textarea readOnly rows={2} aria-label={t('ui.requestDraft.value', { id: draft.id })} value={draft.value} />
      <Button variant="ghost" disabled={busy} onClick={() => onDiscard(draft.id)}>{t('ui.requestDraft.discard')}</Button></div>)}
  </section>;
}
