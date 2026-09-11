import type { TaskDataMode } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { errorMessage } from '../../../shared/api/useApi';
import { formatDateTime } from '../../../shared/lib/dateFormat';
import { useI18n } from '../../../shared/lib/useI18n';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import type { DataBindingsHandle } from '../hooks/useDataBindings';
import { TASK_DATA_MODES, needsApproval } from '../model/agentOptions';
import { bindingStateTone } from '../model/stateTone';
import { Pane } from './Pane';
import { PaneNotice } from './PaneNotice';
import styles from './DataBindingPane.module.css';

/** 数据访问：development 默认即有，诊断只读与生产变更要负责人批准，批准后整个会话容器都生效。 */
export function DataBindingPane({ data }: { readonly data: DataBindingsHandle }): ReactElement {
  const t = useT();
  const { locale } = useI18n();
  const [mode, setMode] = useState<TaskDataMode>('diagnostic-readonly');
  const [reason, setReason] = useState('');
  return (
    <Pane title={t('devSession.data.title')} className={styles.pane}>
      <ul className={styles.bindings}>
        {data.bindings.map((binding) => (
          <li key={binding.id} className={styles.binding}>
            <Badge tone={bindingStateTone(binding.state)}>{t(`devSession.data.state.${binding.state}`)}</Badge>
            <span>{t(`devSession.data.mode.${binding.mode}`)}</span>
            {binding.expiresAt !== undefined ? <span className={styles.meta}>{t('devSession.data.expires', { at: formatDateTime(binding.expiresAt, locale) })}</span> : null}
          </li>
        ))}
      </ul>
      {data.bindings.length === 0 && !data.isPending ? <PaneNotice tone="muted">{t('devSession.data.empty')}</PaneNotice> : null}
      {data.loadError !== null ? <PaneNotice tone="warning">{errorMessage(data.loadError)}</PaneNotice> : null}
      <div className={styles.field}>
        <label htmlFor="binding-mode">{t('devSession.data.request')}</label>
        <select id="binding-mode" className={styles.select} value={mode} onChange={(event) => setMode(event.target.value as TaskDataMode)}>
          {TASK_DATA_MODES.map((option) => (
            <option key={option} value={option}>
              {t(`devSession.data.mode.${option}`)}
            </option>
          ))}
        </select>
      </div>
      <input
        className={styles.input}
        value={reason}
        placeholder={t('devSession.data.reasonPlaceholder')}
        aria-label={t('devSession.data.reason')}
        onChange={(event) => setReason(event.target.value)}
      />
      {needsApproval(mode) ? <PaneNotice tone="warning">{t('devSession.data.approvalWarning')}</PaneNotice> : null}
      <Button
        variant="primary"
        disabled={!data.canRequest || data.request.isPending}
        onClick={() => data.request.mutate({ mode, ...(reason.trim() === '' ? {} : { reason: reason.trim() }) })}
      >
        {data.request.isPending ? t('devSession.data.pending') : t('devSession.data.submit')}
      </Button>
      {!data.canRequest ? <PaneNotice tone="muted">{t('devSession.data.noService')}</PaneNotice> : null}
      {data.request.error !== null ? <PaneNotice tone="warning">{errorMessage(data.request.error)}</PaneNotice> : null}
    </Pane>
  );
}
