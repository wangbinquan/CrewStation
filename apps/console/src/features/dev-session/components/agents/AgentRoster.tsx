import type { AgentInstanceDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { agentStateTone } from '../../model/stateTone';
import styles from './AgentRoster.module.css';

export interface AgentRosterProps {
  readonly agents: readonly AgentInstanceDto[];
  readonly selected: string | undefined;
  readonly onSelect: (agentId: string) => void;
}

/** 并行 Agent 的切换条：转录按 agentId 各自保留，来回切不丢。 */
export function AgentRoster({ agents, selected, onSelect }: AgentRosterProps): ReactElement {
  const t = useT();
  return (
    <div className={styles.roster} role="tablist" aria-label={t('devSession.agents.rosterLabel')}>
      {agents.map((agent) => (
        <button
          key={agent.agentId}
          type="button"
          role="tab"
          aria-selected={agent.agentId === selected}
          className={[styles.tab, agent.agentId === selected ? styles.active : ''].filter(Boolean).join(' ')}
          onClick={() => onSelect(agent.agentId)}
        >
          <span className={styles.compute}>L-{agent.agentId.slice(-6)} · {agent.compute}</span>
          <Badge tone={agentStateTone(agent.state)}>{t(`devSession.agentState.${agent.state}`)}</Badge>
        </button>
      ))}
    </div>
  );
}
