import type { ActivateRuntimeConfigRequest, DisableRuntimeConfigRequest, RuntimeCheckDto, RuntimeCheckStage, RuntimeConfigDetailDto } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, useApiMutation } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Badge } from '../../../../shared/ui/Badge';
import type { BadgeTone } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { ConfirmationPanel } from '../../../../shared/ui/ConfirmationPanel';
import { useRuntimeCheck } from '../../hooks/useRuntimeCheck';
import { AdminField } from '../AdminField';
import styles from './RuntimeEditor.module.css';

export interface RuntimeCheckPanelProps {
  readonly detail: RuntimeConfigDetailDto;
  /** 有未保存修改时不能发起检查：检查绑定的是已保存的版本内容。 */
  readonly dirty: boolean;
  readonly onLocate: (stepId: string) => void;
  readonly onChanged: (detail: RuntimeConfigDetailDto) => void;
}

const INVALIDATE = [queryKeys.runtimeConfigs(), queryKeys.computeProfilesFull(), queryKeys.computeProfiles()];

/** 检查、启用与停用：启用只接受与当前草稿版本＋内容哈希完全一致的通过检查。 */
export function RuntimeCheckPanel({ detail, dirty, onLocate, onChanged }: RuntimeCheckPanelProps): ReactElement {
  const t = useT();
  const check = useRuntimeCheck(detail.id, detail.latestCheckId);
  const [model, setModel] = useState('');
  const [confirm, setConfirm] = useState<'activate' | 'disable' | null>(null);
  const activate = useApiMutation((input: ActivateRuntimeConfigRequest) => api.agentRuntime.activate(detail.id, input), { invalidate: INVALIDATE, onSuccess: (next) => { onChanged(next); setConfirm(null); } });
  const disable = useApiMutation((input: DisableRuntimeConfigRequest) => api.agentRuntime.disable(detail.id, input), { invalidate: INVALIDATE, onSuccess: (next) => { onChanged(next); setConfirm(null); } });
  const result = check.check.data;
  const usable = result !== undefined && result.state === 'succeeded' && result.revision === detail.draftRevision && result.contentHash === detail.draft.contentHash;
  const busy = activate.isPending || disable.isPending;
  return (
    <div className={styles.sub}>
      <h3>{t('admin.runtime.section.check')}</h3>
      <p className={styles.hint}>{t('admin.runtime.check.hint')}</p>
      <p className={styles.hint}>{detail.activeRevision === null ? t('admin.runtime.inactiveNote') : t('admin.runtime.activeNote', { revision: detail.activeRevision, draft: detail.draftRevision })}</p>
      <p className={styles.hint}>{detail.referencedBy.length === 0 ? t('admin.runtime.referencedNone') : t('admin.runtime.referencedBy', { names: detail.referencedBy.join(', ') })}</p>
      <div className={styles.fields}>
        <AdminField label={t('admin.runtime.check.model')} value={model} onChange={setModel} placeholder={detail.draft.defaultModel} disabled={check.running} />
      </div>
      <div className={styles.toolbar}>
        <Button variant="primary" disabled={dirty || check.running || busy} onClick={() => check.start.mutate({ revision: detail.draftRevision, ...(model.trim() === '' ? {} : { model: model.trim() }) })}>
          {check.start.isPending ? t('admin.runtime.check.starting') : t('admin.runtime.check.start', { revision: detail.draftRevision })}
        </Button>
        {usable && confirm === null ? <Button variant="primary" disabled={busy || dirty} onClick={() => setConfirm('activate')}>{t('admin.runtime.activate', { revision: result.revision })}</Button> : null}
        {detail.enabled && detail.activeRevision !== null && confirm === null ? <Button disabled={busy} onClick={() => setConfirm('disable')}>{t('admin.runtime.disable')}</Button> : null}
        {dirty ? <span className={styles.hint}>{t('admin.runtime.check.needSave')}</span> : null}
      </div>
      {check.start.error ? <ActionNote tone="error">{t('admin.runtime.check.error', { message: errorMessage(check.start.error) })}</ActionNote> : null}
      {check.check.error ? <ActionNote tone="error">{t('admin.runtime.check.error', { message: errorMessage(check.check.error) })}</ActionNote> : null}
      {activate.error ? <ActionNote tone="error">{t('admin.runtime.activateError', { message: errorMessage(activate.error) })}</ActionNote> : null}
      {disable.error ? <ActionNote tone="error">{t('admin.runtime.disableError', { message: errorMessage(disable.error) })}</ActionNote> : null}
      {confirm === 'activate' && result ? (
        <ConfirmationPanel question={t('admin.runtime.activateQuestion', { name: detail.name, revision: result.revision })} hint={t('admin.runtime.activateHint')}
          confirmLabel={activate.isPending ? t('admin.runtime.activating') : t('admin.runtime.activate', { revision: result.revision })} cancelLabel={t('admin.runtime.cancel')} busy={activate.isPending}
          onCancel={() => setConfirm(null)} onConfirm={() => activate.mutate({ expectedActiveRevision: detail.activeRevision, revision: result.revision, checkId: result.checkId })} />
      ) : null}
      {confirm === 'disable' && detail.activeRevision !== null ? (
        <ConfirmationPanel question={t('admin.runtime.disableQuestion', { name: detail.name })} hint={t('admin.runtime.disableHint')}
          confirmLabel={disable.isPending ? t('admin.runtime.disabling') : t('admin.runtime.disable')} cancelLabel={t('admin.runtime.cancel')} busy={disable.isPending}
          onCancel={() => setConfirm(null)} onConfirm={() => disable.mutate({ expectedActiveRevision: detail.activeRevision! })} />
      ) : null}
      {result ? <RuntimeCheckResult result={result} stale={result.state === 'succeeded' && !usable} onLocate={onLocate} /> : null}
    </div>
  );
}

function checkTone(state: RuntimeCheckDto['state']): BadgeTone {
  if (state === 'succeeded') return 'success';
  if (state === 'failed') return 'danger';
  if (state === 'unknown' || state === 'cancelled') return 'warning';
  return 'info';
}

function stageTone(state: RuntimeCheckStage['state']): BadgeTone {
  if (state === 'succeeded') return 'success';
  if (state === 'failed') return 'danger';
  if (state === 'running') return 'info';
  return 'neutral';
}

function RuntimeCheckResult({ result, stale, onLocate }: { readonly result: RuntimeCheckDto; readonly stale: boolean; readonly onLocate: (stepId: string) => void }): ReactElement {
  const t = useT();
  const terminal = result.state === 'succeeded' || result.state === 'failed' || result.state === 'cancelled' || result.state === 'unknown';
  const context = result.context;
  return (
    <div className={styles.stageBody} aria-live="polite">
      <div className={styles.toolbar}>
        <Badge tone={checkTone(result.state)}>{terminal ? t(`admin.runtime.check.result.${result.state}`) : t('admin.runtime.check.running', { state: result.state })}</Badge>
        <span className={styles.hint}>{t('admin.runtime.check.forRevision', { revision: result.revision, hash: result.contentHash.slice(0, 12) })}</span>
      </div>
      {stale ? <ActionNote tone="neutral">{t('admin.runtime.check.staleForDraft')}</ActionNote> : null}
      {result.error ? <ActionNote tone="error">{result.error}</ActionNote> : null}
      {context.taskId || context.image ? (
        <p className={styles.hint}>{t('admin.runtime.check.context', { image: context.image ?? '—', digest: context.imageDigest ? `@${context.imageDigest}` : '', cli: context.cliVersion ?? '—', interpreters: (context.interpreters ?? []).map((i) => `${i.language}${i.version ? ` ${i.version}` : ''}`).join(', ') || '—', taskId: context.taskId ?? '—' })}</p>
      ) : null}
      <ol className={styles.timeline}>
        {result.stages.map((stage) => (
          <li key={stage.id} className={styles.stage}>
            <Badge tone={stageTone(stage.state)}>{t(`admin.runtime.check.stageState.${stage.state}`)}</Badge>
            <div className={styles.stageBody}>
              <div className={styles.toolbar}>
                <strong>{stage.name}</strong>
                {stage.durationMs !== undefined ? <span className={styles.hint}>{t('admin.runtime.check.duration', { ms: stage.durationMs })}</span> : null}
                {stage.stepId ? <Button variant="ghost" onClick={() => onLocate(stage.stepId!)}>{t('admin.runtime.check.locate')}</Button> : null}
              </div>
              {stage.detail ? <p className={styles.detail}>{stage.detail}</p> : null}
              {stage.error ? <p className={styles.detail}><code>{stage.error.code}</code> {stage.error.message}</p> : null}
              {stage.log && (stage.log.stdoutTail || stage.log.stderrTail) ? <pre className={styles.log} aria-label={t('admin.runtime.check.log')}>{[stage.log.stdoutTail, stage.log.stderrTail].filter(Boolean).join('\n')}</pre> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
