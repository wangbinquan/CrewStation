import { useState } from 'react';
import type { ReactElement } from 'react';
import { errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import type { DevAgentsHandle } from '../../hooks/useDevAgents';
import { useHistoricalMessages } from '../../hooks/useHistoricalMessages';
import { useHistoricalStart } from '../../hooks/useHistoricalStart';
import type { TranscriptsByAgent } from '../../model/agentTranscript';
import { agentAcceptsInput } from '../../model/stateTone';
import { Pane } from '../Pane';
import { PaneNotice } from '../PaneNotice';
import { AgentComposer } from './AgentComposer';
import { AgentRoster } from './AgentRoster';
import { AgentTranscriptView } from './AgentTranscriptView';
import { StartAgentForm } from './StartAgentForm';
import styles from './AgentsPane.module.css';

export interface AgentsPaneProps {
  readonly agents: DevAgentsHandle;
  readonly transcripts: TranscriptsByAgent;
  readonly onActivity: () => void;
  readonly initialAgentId?: string;
}

/** Agent 面板：并行 Agent 的名册、当前 Agent 的转录与输入框，以及新建入口。 */
export function AgentsPane({ agents, transcripts, onActivity, initialAgentId }: AgentsPaneProps): ReactElement {
  const t = useT();
  const [choice, setChoice] = useState<{ source?: string; agentId?: string }>({});
  const messages = useHistoricalMessages(agents.sendMessage);
  const picked = choice.source === initialAgentId ? choice.agentId : initialAgentId;
  const setPicked = (agentId: string) => setChoice({ source: initialAgentId, agentId });
  const creation = useHistoricalStart(agents.start, (agentId, showResult) => {
    if (showResult) setPicked(agentId);
    onActivity();
  });
  // 没选过就看第一个：名册异步到达时不需要在 effect 里补 setState。
  const selected = picked === undefined ? agents.agents[0] : agents.agents.find((agent) => agent.agentId === picked);
  const draft = selected === undefined ? undefined : messages.drafts[selected.agentId];
  const lines = selected === undefined ? [] : (transcripts[selected.agentId] ?? []);
  return (
    <><UnsavedChangesGuard dirty={messages.dirty || messages.busy || creation.dirty || creation.busy} scope={t('devSession.agents.draftScope')}
      allowNavigate={(current, next) => current.pathname === next.pathname} isNavigationBusy={() => messages.busy || creation.busy} />
    <Pane
      title={t('devSession.agents.title')}
      className={styles.pane}
      flush
      extra={
        <Button onClick={() => creation.setOpen(!creation.open)}>{creation.open ? t('devSession.agents.startCancel') : t('devSession.agents.start')}</Button>
      }
    >
      <div className={styles.layout}>
        {messages.busy ? <PaneNotice tone="info">{t('devSession.agents.sendingHint')}</PaneNotice> : null}
        {creation.busy ? <PaneNotice tone="info">{t('devSession.agents.startingHint')}</PaneNotice> : null}
        {creation.error ? <PaneNotice tone="warning">{creation.error}</PaneNotice> : null}
        {creation.open ? (
          <StartAgentForm creation={creation} />
        ) : (
          <>
            <AgentRoster agents={agents.agents} selected={selected?.agentId} onSelect={setPicked} />
            {agents.agents.length === 0 ? <PaneNotice tone="muted">{t('devSession.agents.empty')}</PaneNotice> : null}
            {agents.loadError !== null ? <PaneNotice tone="warning">{errorMessage(agents.loadError)}</PaneNotice> : null}
            {!agents.isPending && picked !== undefined && selected === undefined ? <PaneNotice tone="warning">{t('devSession.agents.missingTarget')}</PaneNotice> : null}
            <AgentTranscriptView lines={lines} />
            <AgentComposer
              disabled={selected === undefined || !agentAcceptsInput(selected.state)}
              sending={draft?.sending ?? false}
              draft={draft?.text ?? ''}
              error={draft?.error}
              onDraftChange={(text) => { if (selected !== undefined) messages.edit(selected.agentId, text); }}
              canCancel={selected !== undefined && agentAcceptsInput(selected.state)}
              onCancel={() => {
                if (selected !== undefined) agents.cancel.mutate(selected.agentId);
              }}
              onSend={() => {
                if (selected === undefined) return;
                if (messages.send(selected.agentId)) onActivity();
              }}
            />
          </>
        )}
      </div>
    </Pane></>
  );
}
