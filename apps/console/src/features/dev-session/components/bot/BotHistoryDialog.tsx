import { useState } from 'react';
import type { AgentInstanceDto } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Dialog } from '../../../../shared/ui/dialog/Dialog';
import { ConfirmationDialog } from '../../../../shared/ui/dialog/ConfirmationDialog';
import { errorMessage } from '../../../../shared/api/useApi';
import type { ContinuousBotHandle } from '../../hooks/bot/useContinuousBot';
import styles from './BotConversation.module.css';

export function BotHistoryDialog({ bot, agents, onSelect, onClose }: { readonly bot: ContinuousBotHandle; readonly agents: readonly AgentInstanceDto[]; readonly onSelect: (id: string) => void; readonly onClose: () => void }) {
  const t = useT(), [confirm, setConfirm] = useState(false), current = bot.conversation;
  return <Dialog title={t('devSession.continuous.history')} size="large" onClose={onClose}>
    <p>{t('devSession.continuous.independent')}</p>
    <div className={styles.historyActions}><Button onClick={() => { onSelect(''); onClose(); }}>{t('devSession.continuous.return')}</Button>
      {current ? <Button disabled={bot.fresh.isPending || current.state === 'stopping'} onClick={() => setConfirm(true)}>{t('devSession.continuous.fresh')}</Button> : null}</div>
    {current ? <p>{current.computeName} · {t('devSession.continuous.epoch', { number: current.epoch })} · {t(`devSession.continuous.state.${current.state}`)}</p> : null}
    <ul className={styles.historyList}>
      {[...bot.executions].reverse().map(execution => <li key={execution.agentId}><span>{t('devSession.continuous.epoch', { number: execution.epoch })} · {t(`devSession.continuous.state.${execution.state}`)}</span><code>{execution.nativeSessionId ?? t('devSession.continuous.sessionPending')}</code></li>)}
    </ul>
    {bot.hasMore ? <Button disabled={bot.loadingMore} onClick={() => void bot.more()}>{t('devSession.continuous.more')}</Button> : null}
    {bot.historyError ? <ActionNote tone="error">{bot.historyError}</ActionNote> : null}
    {agents.length ? <><h3>{t('devSession.continuous.legacy')}</h3><p>{t('devSession.continuous.legacyHint')}</p><ul className={styles.historyList}>
      {agents.map((agent, index) => <li key={agent.agentId}><Button variant="ghost" onClick={() => { onSelect(agent.agentId); onClose(); }}>{agent.initialPrompt?.slice(0, 100) || t('devSession.bot.conversationName', { number: index + 1 })}</Button><span>{t(`devSession.agentState.${agent.state}`)}</span></li>)}
    </ul></> : null}
    {confirm ? <ConfirmationDialog title={t('devSession.continuous.fresh')} question={t('devSession.continuous.freshQuestion')} hint={t('devSession.continuous.freshHint')}
      confirmLabel={t('devSession.continuous.freshConfirm')} busy={bot.fresh.isPending} onCancel={() => setConfirm(false)} onConfirm={() => bot.fresh.mutate(undefined, { onSuccess: () => { setConfirm(false); onSelect(''); } })}>
      {bot.fresh.error ? <ActionNote tone="error">{errorMessage(bot.fresh.error)}</ActionNote> : null}
    </ConfirmationDialog> : null}
  </Dialog>;
}
