import { useState } from 'react';
import type { ReactElement } from 'react';
import { errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import type { DevAgentsHandle } from '../../hooks/useDevAgents';
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
}

/** Agent 面板：并行 Agent 的名册、当前 Agent 的转录与输入框，以及新建入口。 */
export function AgentsPane({ agents, transcripts, onActivity }: AgentsPaneProps): ReactElement {
  const t = useT();
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  // 没选过就看第一个：名册异步到达时不需要在 effect 里补 setState。
  const selected = agents.agents.find((agent) => agent.agentId === picked) ?? agents.agents[0];
  const lines = selected === undefined ? [] : (transcripts[selected.agentId] ?? []);
  return (
    <Pane
      title={t('devSession.agents.title')}
      className={styles.pane}
      flush
      extra={
        <Button onClick={() => setStarting((value) => !value)}>{starting ? t('devSession.agents.startCancel') : t('devSession.agents.start')}</Button>
      }
    >
      <div className={styles.layout}>
        {starting ? (
          <StartAgentForm
            agents={agents}
            onCancel={() => setStarting(false)}
            onStarted={(agentId) => {
              setPicked(agentId);
              setStarting(false);
              onActivity();
            }}
          />
        ) : (
          <>
            <AgentRoster agents={agents.agents} selected={selected?.agentId} onSelect={setPicked} />
            {agents.agents.length === 0 ? <PaneNotice tone="muted">{t('devSession.agents.empty')}</PaneNotice> : null}
            {agents.loadError !== null ? <PaneNotice tone="warning">{errorMessage(agents.loadError)}</PaneNotice> : null}
            <AgentTranscriptView lines={lines} />
            <AgentComposer
              disabled={selected === undefined || !agentAcceptsInput(selected.state)}
              sending={agents.sendMessage.isPending}
              canCancel={selected !== undefined && agentAcceptsInput(selected.state)}
              onCancel={() => {
                if (selected !== undefined) agents.cancel.mutate(selected.agentId);
              }}
              onSend={(content) => {
                if (selected === undefined) return;
                onActivity();
                agents.sendMessage.mutate({ agentId: selected.agentId, content });
              }}
            />
          </>
        )}
      </div>
    </Pane>
  );
}
