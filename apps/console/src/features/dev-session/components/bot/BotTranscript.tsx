import { useRef } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { GlyphIcon } from '../../../../shared/ui/icons/GlyphIcon';
import { useTailFollow } from '../../hooks/useTailFollow';
import type { TranscriptLine } from '../../model/agentTranscript';
import { BotMessageBody } from './BotMessageBody';
import styles from './BotConversation.module.css';

type Entry = { kind: 'user'; line: TranscriptLine } | { kind: 'answer'; line: TranscriptLine } | { kind: 'activity'; lines: TranscriptLine[] };
const visibleActivity = (line: TranscriptLine) => !['usage', 'session', 'started'].includes(line.type);
function entries(lines: readonly TranscriptLine[]): Entry[] {
  const result: Entry[] = [];
  for (const line of lines) {
    if (line.type === 'user-message') result.push({ kind: 'user', line });
    else if (line.type === 'text' || line.type === 'completed' && line.body && !lines.some(item => item.type === 'text' && item.body === line.body)) result.push({ kind: 'answer', line });
    else if (visibleActivity(line)) {
      const previous = result.at(-1);
      if (previous?.kind === 'activity') previous.lines.push(line); else result.push({ kind: 'activity', lines: [line] });
    }
  }
  return result;
}
export function BotTranscript({ lines, running, onSuggestion, hasConversation }: {
  readonly lines: readonly TranscriptLine[]; readonly running: boolean;
  readonly onSuggestion: (text: string) => void; readonly hasConversation: boolean;
}) {
  const t = useT(), container = useRef<HTMLDivElement>(null), tail = useTailFollow(container, `${lines.length}:${lines.at(-1)?.body.length}`);
  const items = entries(lines);
  return <div className={styles.transcript}>
    <div ref={hasConversation ? container : undefined} className={styles.messages} role="log" aria-live="polite" aria-label={t('devSession.bot.messages')} onScroll={tail.onScroll}>
      {!hasConversation && items.length === 0 ? <div className={styles.welcome}>
        <GlyphIcon name="spark" /><h2>{t('devSession.bot.welcome')}</h2><p>{t('devSession.bot.welcomeHint')}</p>
        <div className={styles.suggestions}>{['create', 'improve', 'inspect'].map(key => <Button key={key} className={styles.suggestion} onClick={() => onSuggestion(t(`devSession.bot.suggestion.${key}.prompt`))}>
          {t(`devSession.bot.suggestion.${key}`)}
        </Button>)}</div>
      </div> : null}
      {items.map((item, index) => {
        if (item.kind === 'user') return <article key={item.line.id} className={styles.userMessage} aria-label={t('devSession.bot.you')}><div>{item.line.body}</div></article>;
        if (item.kind === 'answer') return <article key={item.line.id} className={styles.botMessage} aria-label="Crew Bot"><div className={styles.author}><GlyphIcon name="assistant" plain /><strong>Crew Bot</strong></div><div className={styles.botBubble}><BotMessageBody text={item.line.body} /></div></article>;
        const failed = item.lines.some(line => line.failed || line.type === 'error');
        return <details key={`activity:${item.lines[0]?.id ?? index}`} className={styles.activity} open={failed || undefined}>
          <summary>{failed ? t('devSession.bot.activityFailed') : t('devSession.bot.activity')} <span>{item.lines.length}</span></summary>
          {item.lines.map(line => <div key={line.id} data-failed={line.failed || line.type === 'error'}><span>{t(`devSession.agentEvent.${line.type}`)}</span>{line.body ? <pre>{line.body}</pre> : null}</div>)}
        </details>;
      })}
      {running ? <div className={styles.working} role="status"><span className={styles.pulse} />{t('devSession.bot.working')}</div> : null}
      {hasConversation && items.length === 0 && !running ? <p className={styles.hint}>{t('devSession.agents.transcriptEmpty')}</p> : null}
    </div>
    {!tail.following ? <div className={styles.tail}><Button size="small" onClick={tail.scrollToTail}>{t('devSession.agents.toTail')}</Button></div> : null}
  </div>;
}
