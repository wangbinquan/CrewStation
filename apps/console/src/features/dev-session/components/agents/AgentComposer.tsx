import { useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import styles from './AgentComposer.module.css';

export interface AgentComposerProps {
  readonly disabled: boolean;
  readonly sending: boolean;
  readonly onSend: (content: string) => void;
  readonly onCancel: () => void;
  readonly canCancel: boolean;
}

/** 给流式 Agent 追加一条消息；Ctrl／Cmd＋Enter 发送，Enter 仍是换行。 */
export function AgentComposer({ disabled, sending, onSend, onCancel, canCancel }: AgentComposerProps): ReactElement {
  const t = useT();
  const [draft, setDraft] = useState('');
  const send = (): void => {
    const content = draft.trim();
    if (content === '' || disabled) return;
    onSend(content);
    setDraft('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    }
  };
  return (
    <div className={styles.composer}>
      <textarea
        className={styles.input}
        rows={2}
        value={draft}
        disabled={disabled}
        placeholder={t('devSession.agents.messagePlaceholder')}
        aria-label={t('devSession.agents.message')}
        onChange={(event) => setDraft(event.target.value)}
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
    </div>
  );
}
