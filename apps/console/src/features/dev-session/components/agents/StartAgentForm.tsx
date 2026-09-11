import type { AgentDriver, AgentPermission } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import type { DevAgentsHandle } from '../../hooks/useDevAgents';
import { AGENT_DRIVERS, AGENT_PERMISSIONS } from '../../model/agentOptions';
import { PaneNotice } from '../PaneNotice';
import styles from './StartAgentForm.module.css';

export interface StartAgentFormProps {
  readonly agents: DevAgentsHandle;
  readonly onStarted: (agentId: string) => void;
  readonly onCancel: () => void;
}

/** 启动一个流式交互 Agent。模型是自由文本：可用模型由平台与驱动决定，工作台不写死清单。 */
export function StartAgentForm({ agents, onStarted, onCancel }: StartAgentFormProps): ReactElement {
  const t = useT();
  const [driver, setDriver] = useState<AgentDriver>('claude-code');
  const [model, setModel] = useState('');
  const [permission, setPermission] = useState<AgentPermission>('edit');
  const [prompt, setPrompt] = useState('');
  const ready = model.trim() !== '' && prompt.trim() !== '';
  const start = (): void => {
    agents.start.mutate(
      { driver, model: model.trim(), permission, prompt: prompt.trim() },
      { onSuccess: (agent) => onStarted(agent.agentId) },
    );
  };
  return (
    <div className={styles.form}>
      <div className={styles.row}>
        <label htmlFor="agent-driver">{t('devSession.agents.driver')}</label>
        <select id="agent-driver" className={styles.select} value={driver} onChange={(event) => setDriver(event.target.value as AgentDriver)}>
          {AGENT_DRIVERS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <label htmlFor="agent-permission">{t('devSession.agents.permission')}</label>
        <select id="agent-permission" className={styles.select} value={permission} onChange={(event) => setPermission(event.target.value as AgentPermission)}>
          {AGENT_PERMISSIONS.map((option) => (
            <option key={option} value={option}>
              {t(`devSession.agentPermission.${option}`)}
            </option>
          ))}
        </select>
      </div>
      <input
        className={styles.input}
        value={model}
        placeholder={t('devSession.agents.modelPlaceholder')}
        aria-label={t('devSession.agents.model')}
        onChange={(event) => setModel(event.target.value)}
      />
      <textarea
        className={styles.prompt}
        rows={3}
        value={prompt}
        placeholder={t('devSession.agents.promptPlaceholder')}
        aria-label={t('devSession.agents.prompt')}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <div className={styles.actions}>
        <Button variant="primary" disabled={!ready || agents.start.isPending} onClick={start}>
          {agents.start.isPending ? t('devSession.agents.starting') : t('devSession.agents.startSubmit')}
        </Button>
        <Button onClick={onCancel}>{t('devSession.agents.startCancel')}</Button>
      </div>
      {agents.start.error !== null ? <PaneNotice tone="warning">{errorMessage(agents.start.error)}</PaneNotice> : null}
    </div>
  );
}
