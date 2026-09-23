import { useEffect, useId, useRef } from 'react';
import type { ReactElement } from 'react';
import type { ReleaseDto } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { useDateText } from '../../../shared/lib/useDateText';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Button } from '../../../shared/ui/Button';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Dialog, DialogClearButton } from '../../../shared/ui/dialog/Dialog';
import type { PublishSource } from '../../../shared/project/releaseSearch';
import type { PublishDraft } from '../model/usePublishDraft';
import { usePublishPreparation } from '../model/usePublishPreparation';
import type { PublishPreparation } from '../model/usePublishPreparation';
import type { ReleaseActions } from '../model/useReleaseActions';
import { PublishSourceFields } from './PublishSourceFields';
import styles from './PublishDialog.module.css';

export interface PublishDialogProps { readonly serviceId: string; readonly projectId: string; readonly source: PublishSource; readonly canPublish: boolean; readonly actions: ReleaseActions; readonly draft: PublishDraft; readonly onSource: (source: PublishSource) => void; readonly onClose: () => void; readonly onAccepted: (release: ReleaseDto) => void }

/**
 * 唯一发布准备（2026-09-23 起是弹窗）：来源、只读检查、明确发布；202 交给实际 releaseId 详情继续观察。
 * 每一步的按钮在弹窗底部：这一步的主按钮最左（回车同效），「上一步」其次，「取消」无边框，「清空」在最右。
 * 输入在页面上的草稿里：取消、✕、Esc 只关弹窗，再打开恢复。
 */
export function PublishDialog({ serviceId, projectId, source, canPublish, actions, draft, onSource, onClose, onAccepted }: PublishDialogProps): ReactElement {
  const t = useT();
  const p = usePublishPreparation(projectId, serviceId, source, canPublish && actions.busy !== 'traffic', actions, draft, onAccepted);
  const submit = () => { if (p.step === 0) void p.check(); else if (p.step === 1) { if (!p.busy && canPublish && !p.stale) p.setStep(2); } else void p.submit(); };
  const primary = p.step === 0
    ? <Button type="submit" variant="primary" disabled={p.busy || !p.canPublish}>{t(p.checking ? 'release.prepare.checking' : 'release.prepare.check')}</Button>
    : p.step === 1 ? <Button type="submit" variant="primary" disabled={p.busy || !canPublish || p.stale}>{t('release.prepare.reviewVersion')}</Button>
      : <Button type="submit" variant="primary" disabled={p.busy || !!actions.busy || !canPublish || p.tags.isPending || !!p.tags.error || p.stale}>{t(p.busy ? 'release.publish.submitting' : 'release.prepare.submit')}</Button>;
  const footer = <ActionRow>
    {primary}
    {p.step > 0 ? <Button disabled={p.busy} onClick={() => p.setStep(p.step - 1)}>{t('release.prepare.back')}</Button> : null}
    <Button variant="ghost" disabled={p.busy} onClick={onClose}>{t('ui.confirm.no')}</Button>
    <DialogClearButton busy={p.busy} dirty={p.dirty} onClear={p.clear} />
  </ActionRow>;
  return <Dialog title={t('release.prepare.title')} busy={p.busy} footer={footer} onClose={onClose} onSubmit={submit}>
    <ol className={styles.steps}>{['source', 'check', 'version'].map((step, index) => <li key={step} aria-current={p.step === index ? 'step' : undefined}>{index + 1}. {t(`release.prepare.step.${step}`)}</li>)}</ol>
    {!canPublish ? <ActionNote tone="neutral">{t('release.prepare.noPermission')}</ActionNote> : null}
    {p.step === 0 ? <PublishSourceFields preparation={p} onSource={onSource} /> : <CheckedSource preparation={p} source={source} />}
    {p.step === 2 ? <VersionFields preparation={p} /> : null}
    {p.error ? <ActionNote tone="error">{p.error} {p.showHistoryReminder ? t('release.prepare.recheck') : null}</ActionNote> : null}
    {p.failedPaths.length ? <ul>{p.failedPaths.map((path) => <li key={path}><code>{path}</code></li>)}</ul> : null}
    <p className={styles.note}>{t('release.prepare.draftLifetime')}</p>
  </Dialog>;
}

/** 第二、三步上方：检查过的来源与提交；来源在检查之后变了就要重新检查。 */
function CheckedSource({ preparation: p, source }: { readonly preparation: PublishPreparation; readonly source: PublishSource }): ReactElement {
  const t = useT(), date = useDateText();
  return <>
    <DefinitionList items={[
      { label: t('release.prepare.step.source'), value: t(`release.prepare.source.${source}`) },
      { label: t('release.publish.branch'), value: p.snapshot?.branch }, { label: t('release.prepare.sha'), value: <code>{p.snapshot?.commitSha}</code> },
      ...(p.snapshot?.taskId ? [{ label: t('release.prepare.task'), value: <code>{p.snapshot.taskId}</code> }] : []),
      { label: t('release.prepare.checkedAt'), value: date(p.snapshot?.checkedAt) },
    ]} />
    <ActionNote tone="neutral">{t(`release.prepare.checked.${source}`)}</ActionNote>
    {p.stale ? <ActionNote tone="neutral">{t('release.prepare.sourceChanged')} <Button disabled={p.busy} onClick={p.resetCheck}>{t('release.prepare.check')}</Button></ActionNote> : null}
  </>;
}

/** 第三步：版本号与说明；校验失败时焦点落到第一个出错的字段。 */
function VersionFields({ preparation: p }: { readonly preparation: PublishPreparation }): ReactElement {
  const t = useT(), id = useId(), versionInput = useRef<HTMLInputElement>(null), messageInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (p.errors.version) versionInput.current?.focus(); else if (p.errors.message) messageInput.current?.focus(); }, [p.errors]);
  return <>
    <div className={styles.form}>
      <FormField label={t('release.publish.version')} hint={t('release.publish.versionHint')} hintId={`${id}-version-hint`} error={p.errors.version} errorId={`${id}-version-error`}>
        <input ref={versionInput} name="version" value={p.version} disabled={p.busy} aria-invalid={!!p.errors.version} aria-describedby={`${id}-version-hint${p.errors.version ? ` ${id}-version-error` : ''}`} aria-errormessage={p.errors.version ? `${id}-version-error` : undefined} onChange={(event) => { p.setVersion(event.target.value); p.setErrors({ ...p.errors, version: undefined }); }} />
      </FormField>
      <FormField label={t('release.prepare.message')} hint={t('release.prepare.messageHint')} hintId={`${id}-message-hint`} error={p.errors.message} errorId={`${id}-message-error`}>
        <textarea ref={messageInput} name="message" value={p.message} rows={2} disabled={p.busy} aria-invalid={!!p.errors.message} aria-describedby={`${id}-message-hint${p.errors.message ? ` ${id}-message-error` : ''}`} aria-errormessage={p.errors.message ? `${id}-message-error` : undefined} onChange={(event) => { p.setMessage(event.target.value); p.setErrors({ ...p.errors, message: undefined }); }} />
      </FormField>
    </div>
    <QueryStatus isPending={p.tags.isPending} error={p.tags.error} />
    <p>{t('release.prepare.candidate', { tag: p.candidate ?? '—' })}</p>
    <ActionNote tone="neutral">{t('release.prepare.productionWarning')}</ActionNote>
  </>;
}
