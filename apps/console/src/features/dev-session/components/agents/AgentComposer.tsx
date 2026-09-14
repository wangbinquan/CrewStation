import type { KeyboardEvent, ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { PaneNotice } from '../PaneNotice';
import styles from './AgentComposer.module.css';

export interface AgentComposerProps {
  readonly disabled: boolean;
  readonly sending: boolean;
  readonly draft: string;
  readonly error?: string;
  readonly onDraftChange: (draft: string) => void;
  readonly onSend: () => void;
  readonly onCancel: () => void;
  readonly canCancel: boolean;
}

/** 给流式 Agent 追加一条消息；Ctrl／Cmd＋Enter 发送，Enter 仍是换行。 */
export function AgentComposer({ disabled, sending, draft, error, onDraftChange, onSend, onCancel, canCancel }: AgentComposerProps): ReactElement {
  const t = useT();
  const send = (): void => {
    if (draft.trim() === '' || disabled || sending) return;
    onSend();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    }
  };
  return (
    <>{error ? <PaneNotice tone="warning">{error}</PaneNotice> : null}
    <div className={styles.composer}>
      <textarea
        className={styles.input}
        rows={2}
        value={draft}
        disabled={disabled}
        placeholder={t('devSession.agents.messagePlaceholder')}
        aria-label={t('devSession.agents.message')}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.actions}>
        <Button variant="primary" disabled={disabled || sending || draft.trim() === ''} onClick={send}>
          {sending ? t('devSession.agents.sending') : t('devSession.agents.send')}
        </Button>
        <Button disabled={!canCancel} onClick={onCancel}>
          {t('devSession.agents.cancel')}
        </Button>
      </div>
    </div></>
  );
}
