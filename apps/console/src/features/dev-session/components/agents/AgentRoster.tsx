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
  // 启动前 Hook（RFC-004）只展示步骤名与结果；脚本内容、文件正文与输出不会到达租户面。
  const hookLine = (agent: AgentInstanceDto): string | undefined => {
    const hook = agent.beforeStart;
    if (!hook) return undefined;
    if (hook.state === 'queued') return t('devSession.agents.preparingQueued');
    if (hook.state === 'running') return t('devSession.agents.preparing', { step: hook.currentStep ?? '' });
    if (hook.state === 'failed') return t('devSession.agents.preparationFailed', { step: hook.failedStep ?? '', id: hook.executionId.slice(-6) });
    return undefined;
  };
  // RFC-006：每个 Agent 一个执行环境；名册只给简短状态，原因在面板里对选中的 Agent 展开，悬停也能看到。
  const executionLine = (agent: AgentInstanceDto): string | undefined => {
    const execution = agent.execution;
    if (execution === undefined) return undefined;
    if (agent.state === 'failed' && execution.message) return t('devSession.agents.executionFailed');
    if (execution.state === 'queued') return t('devSession.agents.executionQueued');
    if (execution.state === 'starting') return t('devSession.agents.executionStarting');
    return undefined;
  };
  const preparationLine = (agent: AgentInstanceDto): string | undefined => hookLine(agent) ?? executionLine(agent);
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
          {agent.profileRevision ? <small className={styles.compute}>{t('devSession.agents.profileRevision', { revision: agent.profileRevision })}</small> : null}
          <Badge tone={agentStateTone(agent.state)}>{t(`devSession.agentState.${agent.state}`)}</Badge>
          {preparationLine(agent) !== undefined ? <small className={styles.compute} title={agent.execution?.message}>{preparationLine(agent)}</small> : null}
        </button>
      ))}
    </div>
  );
}
