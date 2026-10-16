import { useState } from 'react';
import { BotOptionsDialog } from './BotOptionsDialog';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { GlyphIcon } from '../../../../shared/ui/icons/GlyphIcon';
import { errorMessage } from '../../../../shared/api/useApi';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import type { ContinuousBotHandle } from '../../hooks/bot/useContinuousBot';
import { useBotDraft } from '../../hooks/bot/useBotDraft';
import type { TranscriptLine, TranscriptsByAgent } from '../../model/agentTranscript';
import { BotComposer } from './BotComposer';
import { BotTranscript } from './BotTranscript';
import styles from './BotConversation.module.css';

export function ContinuousConversation({ bot, projectId, draftScope, transcripts, ready, onHistory, onActivity }: {
  readonly projectId: string; readonly bot: ContinuousBotHandle; readonly draftScope: string; readonly transcripts: TranscriptsByAgent; readonly ready: boolean; readonly onHistory: () => void; readonly onActivity: () => void;
}) {
  const t = useT(), draft = useBotDraft(draftScope, bot, onActivity), current = bot.conversation;
  const [optionsOpen, setOptionsOpen] = useState(false);
  const lines: TranscriptLine[] = [], status = current?.state ?? 'empty';
  let epoch = 0;
  for (const execution of bot.executions) {
    if (execution.epoch !== epoch) { epoch = execution.epoch; lines.push({ id: `epoch:${epoch}`, type: 'status', body: '', at: execution.createdAt, failed: false, boundary: t('devSession.continuous.epoch', { number: epoch }) }); }
    const recorded = transcripts[execution.agentId] ?? [];
    if (execution.initialPrompt && !recorded.some(line => line.type === 'user-message')) lines.push({ id: `${execution.agentId}:initial-input`, type: 'user-message', body: execution.initialPrompt, at: execution.createdAt, failed: false });
    lines.push(...recorded);
  }
  const pending = current?.pendingMessage;
  if (pending && !lines.some(line => line.type === 'user-message' && line.body === pending.content && line.at >= pending.createdAt)) lines.push({ id: pending.id, type: 'user-message', body: pending.content, at: pending.createdAt, failed: false });
  const allowed = ready && !bot.pending && !bot.error && ['empty', 'awaiting-input', 'paused'].includes(status) && current?.continuity !== 'unavailable';
  return <div className={styles.conversation}>
    <UnsavedChangesGuard dirty={draft.unsaved} scope={t('devSession.continuous.draftScope')} isNavigationBusy={() => draft.sending} />
    <header className={styles.toolbar}><GlyphIcon name="assistant" plain /><strong className={styles.botTitle}>Crew Bot</strong><span className={styles.botState}>{t(`devSession.continuous.state.${status}`)}</span><Button size="small" variant="ghost" onClick={onHistory}>{t('devSession.continuous.history')}</Button></header>
    {bot.error ? <ActionNote tone="error">{errorMessage(bot.error)}</ActionNote> : null}
    {current?.reason ? <ActionNote tone={current.continuity === 'unavailable' ? 'error' : 'neutral'}>{current.reason}</ActionNote> : null}
    {bot.hasMore ? <Button size="small" variant="ghost" disabled={bot.loadingMore} onClick={() => void bot.more()}>{t('devSession.continuous.more')}</Button> : null}
    <BotTranscript lines={lines} running={['preparing', 'running'].includes(status)} hasConversation={!!current} onSuggestion={draft.edit} />
    {draft.uncertain ? <ActionNote tone="neutral">{t('devSession.continuous.uncertain')} <Button size="small" onClick={draft.send}>{t('devSession.continuous.reconcile')}</Button></ActionNote> : null}
    <BotComposer disabled={!allowed || draft.uncertain} sending={draft.sending} draft={draft.text} error={draft.error} onDraftChange={draft.edit} onSend={draft.send}
      onOptions={!current ? () => setOptionsOpen(true) : undefined} compute={current?.computeName ?? draft.options?.computeName ?? t('devSession.bot.defaultCompute')} canCancel={ready && ['preparing', 'running', 'unknown'].includes(status) && !!current?.execution && !bot.interrupt.isPending}
      onCancel={() => bot.interrupt.mutate()} stopLabel={t('devSession.continuous.stop')}
      unavailable={!ready ? t('devSession.bot.unavailable') : ['paused', 'empty', 'awaiting-input'].includes(status) ? t('devSession.continuous.continueHint') : t(`devSession.continuous.state.${status}`)} />
    {optionsOpen ? <BotOptionsDialog projectId={projectId} value={draft.options ?? {}} onChange={draft.setOptions} onClose={() => setOptionsOpen(false)} /> : null}
    {bot.interrupt.error ? <ActionNote tone="error">{errorMessage(bot.interrupt.error)}</ActionNote> : null}
  </div>;
}
