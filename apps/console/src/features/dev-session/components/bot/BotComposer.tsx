import type { KeyboardEvent } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import type { AgentComposerProps } from '../agents/AgentComposer';
import styles from './BotConversation.module.css';

export function BotComposer({ disabled, sending, draft, error, onDraftChange, onSend, onCancel, canCancel, compute, onOptions, unavailable }: AgentComposerProps & {
  readonly compute: string; readonly onOptions?: () => void; readonly unavailable?: string;
}) {
  const t = useT();
  const send = () => { if (!disabled && !sending && draft.trim()) onSend(); };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); }
  };
  return <div className={styles.composerArea}>
    {error ? <ActionNote tone="error">{error}</ActionNote> : null}
    {unavailable ? <p className={styles.hint}>{unavailable}</p> : null}
    <div className={styles.composer} data-bot-composer="">
      <textarea rows={3} value={draft} disabled={disabled || sending} placeholder={t('devSession.bot.placeholder')} aria-label={t('devSession.agents.message')}
        onChange={event => onDraftChange(event.target.value)} onKeyDown={keyDown} />
      <div className={styles.composerTools}>
        {onOptions ? <Button size="small" disabled={disabled || sending} onClick={onOptions}>{compute}</Button> : <span className={styles.compute}>{compute}</span>}
        <span className={styles.shortcut}>{t('devSession.bot.shortcut')}</span>
        {canCancel ? <Button size="small" disabled={sending} onClick={onCancel}>{t('devSession.bot.stop')}</Button> : null}
        <Button variant="primary" size="small" disabled={disabled || sending || !draft.trim()} onClick={send}>{sending ? t('devSession.agents.sending') : t('devSession.agents.send')}</Button>
      </div>
    </div>
    <p className={styles.footnote}>{t('devSession.bot.composerHint')}</p>
  </div>;
}
