import { useState } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { errorMessage } from '../../../../shared/api/useApi';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { useHistoricalStart } from '../../hooks/useHistoricalStart';
import { useHistoricalMessages } from '../../hooks/useHistoricalMessages';
import type { AgentSelection, DevAgentsHandle } from '../../hooks/useDevAgents';
import type { TranscriptsByAgent } from '../../model/agentTranscript';
import { agentAcceptsInput } from '../../model/stateTone';
import { BotComposer } from '../bot/BotComposer';
import { BotTranscript } from '../bot/BotTranscript';
import { GlyphIcon } from '../../../../shared/ui/icons/GlyphIcon';
import styles from '../bot/BotConversation.module.css';
import { StartAgentForm } from './StartAgentForm';

export function GuidedConversation({ projectId, agents, selection, transcripts, ready, onActivity }: {
  readonly projectId: string; readonly agents: DevAgentsHandle; readonly selection: AgentSelection;
  readonly transcripts: TranscriptsByAgent; readonly ready: boolean; readonly onActivity: () => void;
}) {
  const t = useT(), [newRequest, setNewRequest] = useState(false), messages = useHistoricalMessages(agents.sendMessage);
  const creation = useHistoricalStart(agents.start, id => { selection.select(id); setNewRequest(false); onActivity(); });
  const selected = newRequest ? undefined : selection.selected, draft = selected ? messages.drafts[selected.agentId] : undefined;
  const busy = creation.busy || messages.busy, allowed = ready && !agents.loadError && !agents.isPending;
  const send = () => { if (!allowed) return; if (selected) { if (messages.send(selected.agentId)) onActivity(); } else creation.start(); };
  const running = !!selected && ['preparing', 'starting', 'running'].includes(selected.state);
  const recorded = selected ? transcripts[selected.agentId] ?? [] : [];
  const lines = selected?.initialPrompt && !recorded.some(line => line.type === 'user-message')
    ? [{ id: `${selected.agentId}:initial-input`, type: 'user-message' as const, body: selected.initialPrompt, at: selected.startedAt, failed: false }, ...recorded] : recorded;
  const edit = (text: string) => selected ? messages.edit(selected.agentId, text) : creation.edit({ prompt: text });
  return <div className={styles.conversation}>
    <UnsavedChangesGuard dirty={creation.dirty || messages.dirty || busy} scope={t('devSession.agents.draftScope')} isNavigationBusy={() => busy}
      allowNavigate={(current, next) => current.pathname === next.pathname} />
    <header className={styles.toolbar}><GlyphIcon name="assistant" plain />
      <select aria-label={t('devSession.bot.chooseConversation')} value={selected?.agentId ?? ''} onChange={event => { if (event.target.value) { selection.select(event.target.value); setNewRequest(false); } else setNewRequest(true); }}>
        <option value="">{t('devSession.guided.newRequest')}</option>
        {agents.agents.map((agent, index) => <option key={agent.agentId} value={agent.agentId}>{(agent.initialPrompt || transcripts[agent.agentId]?.find(line => line.type === 'user-message')?.body)?.slice(0, 36) || t('devSession.bot.conversationName', { number: index + 1 })}</option>)}
      </select>
      <Button variant="ghost" size="small" disabled={!allowed || busy} onClick={() => setNewRequest(true)}>{t('devSession.guided.newRequest')}</Button>
    </header>
    {agents.loadError ? <ActionNote tone="error">{errorMessage(agents.loadError)}</ActionNote> : null}
    {selected?.execution?.message ? <ActionNote tone={selected.state === 'failed' ? 'error' : 'neutral'}>{selected.execution.message}</ActionNote> : null}
    <BotTranscript key={selected?.agentId ?? 'new'} lines={lines}
      running={running || creation.busy} hasConversation={!!selected} onSuggestion={edit} />
    <BotComposer disabled={!allowed || !!selected && !agentAcceptsInput(selected.state)} sending={selected ? draft?.sending ?? false : creation.busy}
      draft={selected ? draft?.text ?? '' : creation.prompt} error={selected ? draft?.error : creation.error}
      onDraftChange={edit} onSend={send} compute={selected?.computeName || t('devSession.bot.defaultCompute')}
      onOptions={selected ? undefined : () => creation.setOpen(true)}
      unavailable={!allowed ? t('devSession.bot.unavailable') : selected && !agentAcceptsInput(selected.state) ? t(selected.state === 'preparing' ? 'devSession.bot.preparing' : 'devSession.bot.finished') : undefined}
      canCancel={allowed && !!selected && (running || selected.state === 'awaiting-input') && !agents.cancel.isPending} onCancel={() => { if (selected) agents.cancel.mutate(selected.agentId); }} />
    {agents.cancel.error ? <ActionNote tone="error">{errorMessage(agents.cancel.error)}</ActionNote> : null}
    {creation.open ? <StartAgentForm projectId={projectId} creation={creation} /> : null}
  </div>;
}
