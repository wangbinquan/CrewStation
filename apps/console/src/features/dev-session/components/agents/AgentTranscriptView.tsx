import { useRef } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import type { TranscriptLine } from '../../model/agentTranscript';
import { useTailFollow } from '../../hooks/useTailFollow';
import styles from './AgentTranscriptView.module.css';

function Line({ line, label }: { readonly line: TranscriptLine; readonly label: string }): ReactElement {
  if (line.type === 'text') return <pre className={styles.text}>{line.body}</pre>;
  return (
    <p className={[styles.line, line.failed || line.type === 'error' ? styles.failed : ''].filter(Boolean).join(' ')}>
      <span className={styles.label}>{label}</span>
      {line.body !== '' ? <span className={styles.body}>{line.body}</span> : null}
    </p>
  );
}

/** Agent 输出：默认贴着底跟随；用户往上翻时停下，给一个回到底部的按钮。 */
export function AgentTranscriptView({ lines }: { readonly lines: readonly TranscriptLine[] }): ReactElement {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tail = useTailFollow(containerRef, lines);
  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.scroll} onScroll={tail.onScroll} role="log" aria-live="polite">
        {lines.length === 0 ? <p className={styles.empty}>{t('devSession.agents.transcriptEmpty')}</p> : null}
        {lines.map((line) => (
          <Line key={line.id} line={line} label={t(`devSession.agentEvent.${line.type}`)} />
        ))}
      </div>
      {tail.following ? null : (
        <div className={styles.tailAction}>
          <Button onClick={tail.scrollToTail}>{t('devSession.agents.toTail')}</Button>
        </div>
      )}
    </div>
  );
}
