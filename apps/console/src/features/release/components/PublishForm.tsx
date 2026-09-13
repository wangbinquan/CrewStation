import { useEffect, useId, useRef } from 'react';
import type { ReleaseDto } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { useDateText } from '../../../shared/lib/useDateText';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { FormField } from '../../../shared/ui/FormField';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { UnsavedChangesGuard } from '../../../shared/navigation/UnsavedChangesGuard';
import type { PublishSource } from '../../../shared/project/releaseSearch';
import { usePublishPreparation } from '../model/usePublishPreparation';
import { PublishSourceFields } from './PublishSourceFields';
import styles from './PublishForm.module.css';

export interface PublishFormProps { readonly serviceId: string; readonly projectId: string; readonly source: PublishSource; readonly canPublish: boolean; readonly onSource: (source: PublishSource) => void; readonly onClose: () => void; readonly onAccepted: (release: ReleaseDto) => void }
/** 唯一发布准备：来源、只读检查、明确发布；202 交给实际 releaseId 详情继续观察。 */
export function PublishForm({ serviceId, projectId, source, canPublish, onSource, onClose, onAccepted }: PublishFormProps) {
  const t = useT(), date = useDateText(), id = useId(), form = useRef<HTMLFormElement>(null);
  const p = usePublishPreparation(projectId, serviceId, source, canPublish, onAccepted);
  useEffect(() => { if (Object.keys(p.errors).length) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }, [p.errors]);
  return <Card compact title={t('release.prepare.title')} extra={<Button disabled={p.busy} onClick={onClose}>{t('release.prepare.close')}</Button>}>
    <UnsavedChangesGuard dirty={p.dirty || p.busy} scope={t('release.prepare.title')} allowNavigate={(current, next) => p.accepted.current || (!p.busy && current.pathname === next.pathname && 'source' in next.search && !!next.search.source)} />
    <ol className={styles.steps}>{['source', 'check', 'version'].map((step, index) => <li key={step} aria-current={p.step === index ? 'step' : undefined}>{index + 1}. {t(`release.prepare.step.${step}`)}</li>)}</ol>
    {!canPublish ? <ActionNote tone="neutral">{t('release.prepare.noPermission')}</ActionNote> : null}
    {p.step === 0 ? <PublishSourceFields preparation={p} onSource={onSource} /> : <>
      <DefinitionList items={[
        { label: t('release.prepare.step.source'), value: t(`release.prepare.source.${source}`) },
        { label: t('release.publish.branch'), value: p.snapshot?.branch }, { label: t('release.prepare.sha'), value: <code>{p.snapshot?.commitSha}</code> },
        ...(p.snapshot?.taskId ? [{ label: t('release.prepare.task'), value: <code>{p.snapshot.taskId}</code> }] : []),
        { label: t('release.prepare.checkedAt'), value: date(p.snapshot?.checkedAt) },
      ]} />
      <ActionNote tone="neutral">{t(`release.prepare.checked.${source}`)}</ActionNote>
      {p.stale ? <ActionNote tone="neutral">{t('release.prepare.sourceChanged')} <Button disabled={p.busy} onClick={p.resetCheck}>{t('release.prepare.check')}</Button></ActionNote> : null}
      {p.step === 1 ? <><Button disabled={p.busy} onClick={() => p.setStep(0)}>{t('release.prepare.back')}</Button><Button variant="primary" disabled={p.busy || !canPublish || p.stale} onClick={() => p.setStep(2)}>{t('release.prepare.reviewVersion')}</Button></> : <form ref={form} noValidate aria-label={t('release.prepare.title')} onSubmit={(event) => { event.preventDefault(); void p.submit(); }}>
        <div className={styles.form}>
          <FormField label={t('release.publish.version')} hint={t('release.publish.versionHint')} hintId={`${id}-version-hint`} error={p.errors.version} errorId={`${id}-version-error`}>
            <input name="version" value={p.version} disabled={p.busy} aria-invalid={!!p.errors.version} aria-describedby={`${id}-version-hint${p.errors.version ? ` ${id}-version-error` : ''}`} aria-errormessage={p.errors.version ? `${id}-version-error` : undefined} onChange={(event) => { p.setVersion(event.target.value); p.setErrors({ ...p.errors, version: undefined }); }} />
          </FormField>
          <FormField label={t('release.prepare.message')} hint={t('release.prepare.messageHint')} hintId={`${id}-message-hint`} error={p.errors.message} errorId={`${id}-message-error`}>
            <textarea name="message" value={p.message} rows={2} disabled={p.busy} aria-invalid={!!p.errors.message} aria-describedby={`${id}-message-hint${p.errors.message ? ` ${id}-message-error` : ''}`} aria-errormessage={p.errors.message ? `${id}-message-error` : undefined} onChange={(event) => { p.setMessage(event.target.value); p.setErrors({ ...p.errors, message: undefined }); }} />
          </FormField>
        </div>
        <QueryStatus isPending={p.tags.isPending} error={p.tags.error} />
        <p>{t('release.prepare.candidate', { tag: p.candidate ?? '—' })}</p>
        {p.tags.error ? <Button disabled={p.busy || p.tags.isFetching} onClick={() => void p.tags.refetch()}>{t('release.prepare.refreshTags')}</Button> : null}
        <ActionNote tone="neutral">{t('release.prepare.productionWarning')}</ActionNote>
        <Button disabled={p.busy} onClick={() => p.setStep(1)}>{t('release.prepare.back')}</Button>
        <Button type="submit" variant="primary" disabled={p.busy || !canPublish || p.tags.isPending || !!p.tags.error || p.stale}>{t(p.busy ? 'release.publish.submitting' : 'release.prepare.submit')}</Button>
      </form>}
    </>}
    {p.error ? <ActionNote tone="error">{p.error} {t('release.prepare.recheck')}</ActionNote> : null}
    {p.failedPaths.length ? <ul>{p.failedPaths.map((path) => <li key={path}><code>{path}</code></li>)}</ul> : null}
    <p>{t('release.prepare.draftLifetime')}</p>
  </Card>;
}
