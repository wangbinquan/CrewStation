import type { AgentPermission } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import type { HistoricalStartHandle } from '../../hooks/useHistoricalStart';
import { AGENT_PERMISSIONS } from '../../model/agentOptions';
import { PaneNotice } from '../PaneNotice';
import styles from './StartAgentForm.module.css';

export interface StartAgentFormProps {
  readonly creation: HistoricalStartHandle;
}

/**
 * 启动一个流式交互 Agent。算力由平台统一提供（RFC-001）：这里只选管理员定义的档位名，
 * 厂商、模型与驱动都不出现在租户面——它们是平台的采购信息，业务也无从判断该填什么。
 */
export function StartAgentForm({ creation }: StartAgentFormProps): ReactElement {
  const t = useT();
  const profiles = useApiQuery(queryKeys.computeProfiles(), () => api.catalog.listComputeProfiles());
  const options = profiles.data?.items ?? [];
  const { compute, permission, prompt, busy, edit, start } = creation;
  // 省略档位就走平台默认档，所以空选项是合法的；只有一个档位都没有时才拦住。
  const ready = options.length > 0 && prompt.trim() !== '';
  return (
    <div className={styles.form}>
      <div className={styles.row}>
        <label htmlFor="agent-compute">{t('devSession.agents.compute')}</label>
        <select id="agent-compute" className={styles.select} value={compute} disabled={busy} onChange={(event) => edit({ compute: event.target.value })}>
          <option value="">{t('devSession.agents.computeDefault')}</option>
          {options.map((option) => (
            <option key={option.name} value={option.name}>
              {option.description === '' ? option.name : `${option.name} · ${option.description}`}
            </option>
          ))}
        </select>
        <label htmlFor="agent-permission">{t('devSession.agents.permission')}</label>
        <select id="agent-permission" className={styles.select} value={permission} disabled={busy} onChange={(event) => edit({ permission: event.target.value as AgentPermission })}>
          {AGENT_PERMISSIONS.map((option) => (
            <option key={option} value={option}>
              {t(`devSession.agentPermission.${option}`)}
            </option>
          ))}
        </select>
      </div>
      {profiles.isPending ? <PaneNotice tone="info">{t('devSession.agents.computeLoading')}</PaneNotice> : null}
      {!profiles.isPending && options.length === 0 ? <PaneNotice tone="warning">{t('devSession.agents.computeEmpty')}</PaneNotice> : null}
      <textarea
        className={styles.prompt}
        rows={3}
        value={prompt}
        disabled={busy}
        placeholder={t('devSession.agents.promptPlaceholder')}
        aria-label={t('devSession.agents.prompt')}
        onChange={(event) => edit({ prompt: event.target.value })}
      />
      <div className={styles.actions}>
        <Button variant="primary" disabled={!ready || busy} onClick={start}>
          {busy ? t('devSession.agents.starting') : t('devSession.agents.startSubmit')}
        </Button>
        <Button onClick={() => creation.setOpen(false)}>{t('devSession.agents.startCancel')}</Button>
      </div>
    </div>
  );
}
