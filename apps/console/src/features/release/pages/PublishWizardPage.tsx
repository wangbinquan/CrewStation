import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useT } from '../../../shared/lib/useT';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PROJECT_PATHS, RELEASE_PATHS } from '../../../shared/project/projectPaths';
import { parseReleaseSearch } from '../../../shared/project/releaseSearch';
import { UnsavedChangesGuard } from '../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Button } from '../../../shared/ui/Button';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import { useServiceOfProject } from '../model/useServiceOfProject';
import { useReleasePermissions } from '../model/journey/useReleasePermissions';
import { useWizardPreparation } from '../model/journey/useWizardPreparation';
import { WizardFrame } from '../components/journey/WizardFrame';
import styles from '../components/journey/WizardFrame.module.css';

export function PublishWizardPage() {
  const { projectId } = useProjectScope(), service = useServiceOfProject(projectId), permissions = useReleasePermissions(projectId);
  return <>{!service.serviceId || !permissions.userId ? <QueryStatus isPending={service.isPending || permissions.me.isPending} error={service.error ?? permissions.me.error} />
    : <Preparation key={`${projectId}:${permissions.userId}`} serviceId={service.serviceId} userId={permissions.userId} canPublish={permissions.canPublish} />}</>;
}
function Preparation({ serviceId, userId, canPublish }: { readonly serviceId: string; readonly userId: string; readonly canPublish: boolean }) {
  const t = useT(), { projectId, space } = useProjectScope(), search = parseReleaseSearch(useSearch({ strict: false })), navigate = useNavigate();
  const p = useWizardPreparation({ projectId, serviceId, userId, space, source: search.source ?? 'repository', draftId: search.draft ?? search.source ?? 'repository', canPublish,
    onAccepted: journeyId => { void navigate({ to: RELEASE_PATHS[space].journey, params: { projectId, journeyId }, search: { cursor: search.cursor, filter: search.filter, focus: search.focus }, replace: true }); } });
  const fixed = p.draft.intent, source = fixed?.source ?? p.draft.source, sha = fixed?.commitSha ?? p.snapshot?.commitSha;
  const footer = <>
    {fixed ? <Button variant="primary" disabled={p.busy} onClick={() => void p.recover()}>{t('release.wizard.recover')}</Button>
      : <Button variant="primary" disabled={!canPublish || p.busy || p.pending || !!p.queryError || !p.snapshot || !p.candidate || !!p.versionError || !!p.messageError} onClick={() => void p.submit()}>{t(p.busy ? 'release.publish.submitting' : 'release.wizard.build')}</Button>}
    <ButtonLink to={PROJECT_PATHS[space].release} params={{ projectId }} search={{ cursor: search.cursor, filter: search.filter }} variant="ghost">{t('release.wizard.later')}</ButtonLink>
    {!fixed ? <Button variant="ghost" disabled={p.busy} onClick={p.clear}>{t('release.wizard.clear')}</Button> : null}
  </>;
  return <WizardFrame step={0} current={0} footer={footer} backSearch={{ cursor: search.cursor, filter: search.filter }}>
    <UnsavedChangesGuard dirty={!p.saved && (!!p.draft.message || !!p.draft.tag || !!fixed)} scope={t('release.draft.publish')} />
    {!canPublish ? <ActionNote tone="neutral">{t('release.prepare.noPermission')}</ActionNote> : null}
    {fixed ? <ActionNote tone="neutral">{t('release.wizard.sentIntent', { tag: fixed.tag })}</ActionNote> : null}
    <ActionRow>{(['repository', 'session'] as const).map(value => <Button key={value} aria-pressed={source === value} disabled={p.busy || !!fixed} onClick={() => p.set({ source: value })}>{t(`release.prepare.source.${value}`)}</Button>)}</ActionRow>
    <div className={styles.form}>
      <FormField label={t('release.publish.branch')} hint={t(`release.prepare.hint.${source}`)}>
        {source === 'repository' && !fixed ? <select name="branch" value={p.selected} disabled={p.busy || p.branches.isPending || !!p.branches.error} onChange={event => p.set({ branch: event.target.value })}>
          {!p.branches.data?.items.length ? <option value="">{t('release.prepare.unknown')}</option> : null}
          {p.branches.data?.items.map(branch => <option key={branch.name} value={branch.name}>{branch.name} · {branch.headSha.slice(0, 10)}</option>)}
        </select> : <code>{fixed?.branch ?? p.snapshot?.branch ?? '—'}</code>}
      </FormField>
      <FormField label={t('release.prepare.sha')}><code className={styles.code}>{sha ?? '—'}</code></FormField>
      {source === 'session' && (fixed?.taskId ?? p.snapshot?.taskId) ? <FormField label={t('release.prepare.task')}><code>{fixed?.taskId ?? p.snapshot?.taskId}</code></FormField> : null}
      <FormField label={t('release.publish.version')} hint={t('release.wizard.tagHint')} error={!fixed ? p.versionError : undefined} errorId="release-version-error">
        <input name="version" value={fixed?.tag ?? p.draft.tag} placeholder={p.candidate ?? 'v1.0.0'} maxLength={80} aria-invalid={!!p.versionError} aria-describedby={p.versionError ? 'release-version-error' : undefined} disabled={p.busy || !!fixed} onChange={event => p.set({ tag: event.target.value })} />
      </FormField>
      <p>{t('release.prepare.candidate', { tag: fixed?.tag ?? p.candidate ?? '—' })}</p>
      <div className={styles.full}><FormField label={t('release.prepare.message')} hint={t('release.prepare.messageHint')} error={!fixed ? p.messageError : undefined} errorId="release-message-error">
        <textarea name="message" rows={3} maxLength={500} aria-invalid={!!p.messageError} aria-describedby={p.messageError ? 'release-message-error' : undefined} value={fixed?.message ?? p.draft.message} disabled={p.busy || !!fixed} onChange={event => p.set({ message: event.target.value })} />
      </FormField></div>
    </div>
    {!fixed ? <QueryStatus isPending={p.pending} error={p.queryError} /> : null}
    {p.problem && !fixed ? <ActionNote tone="neutral">{p.problem.startsWith('release.') ? t(p.problem) : p.problem}</ActionNote> : null}
    {source === 'session' && !fixed && p.workspace.data?.status === 'ready' && p.workspace.data.uncommittedCount > 0 ? <ul>{p.workspace.data.uncommitted.map(file => <li key={file.path}>{file.status.includes('D') ? <code>{file.path}</code> : <Link to={PROJECT_PATHS[space].development} params={{ projectId }} search={{ view: 'code', file: file.path, task: p.workspace.data!.taskId }}>{file.path}</Link>}</li>)}</ul> : null}
    {source === 'session' ? <ButtonLink to={PROJECT_PATHS[space].development} params={{ projectId }} search={{ view: 'diff' }}>{t('release.prepare.openDevelopment')}</ButtonLink> : null}
    {p.error ? <ActionNote tone="error">{p.error}</ActionNote> : null}
    <ActionNote tone="neutral">{t('release.prepare.productionWarning')}</ActionNote>
    <p className={styles.muted}>{t(p.saved ? 'release.wizard.draftSaved' : 'release.wizard.storageUnavailable')}</p>
  </WizardFrame>;
}
