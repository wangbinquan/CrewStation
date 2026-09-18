import type { ComputeProfileDetailDto } from '@crewstation/contracts';
import { BEFORE_START_LIMITS } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, useApiQuery } from '../../../../shared/api/useApi';
import { usePollingRefetch } from '../../../../shared/lib/usePollingRefetch';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { useProfileDraft } from '../../hooks/useProfileDraft';
import type { ProfileDraftHandle } from '../../hooks/useProfileDraft';
import { useProfileSave } from '../../hooks/useProfileSave';
import { blankDraft, draftFromDetail } from '../../model/profileDraft';
import { shortDigest, testRunning } from '../../model/profileStatus';
import { BeforeStartStepEditor } from './BeforeStartStepEditor';
import { BeforeStartStepList } from './BeforeStartStepList';
import styles from './ComputeEditor.module.css';
import { ProfileBasicsSection } from './ProfileBasicsSection';
import { ProfileLaunchSection } from './ProfileLaunchSection';
import { ConfigFileSection, TerminalTestSection } from './ProfileProtocolSections';
import { AvailabilityBadge } from './ProfileStatusBadges';
import { ProfileTestPanel } from './ProfileTestPanel';
import { ProfileVariablesEditor } from './ProfileVariablesEditor';

export interface ComputeProfileEditorProps {
  /** 省略即新建。 */
  readonly name?: string;
  readonly onClose: () => void;
  /** 新建成功后切到该档位的编辑页（测试结果在那里看）。 */
  readonly onCreated: (name: string) => void;
}

export function ComputeProfileEditor({ name, onClose, onCreated }: ComputeProfileEditorProps): ReactElement {
  return name === undefined ? <ProfileEditorForm key="new" onClose={onClose} onCreated={onCreated} /> : <ExistingProfileEditor key={name} name={name} onClose={onClose} onCreated={onCreated} />;
}

/** 载入详情后才建草稿；保存后服务端自动排测试，测试未结束时按短间隔重读详情。 */
function ExistingProfileEditor({ name, onClose, onCreated }: Required<ComputeProfileEditorProps>): ReactElement {
  const t = useT();
  const query = useApiQuery(queryKeys.adminComputeProfile(name), () => api.computeProfiles.get(name));
  usePollingRefetch(query.refetch, 2000, testRunning(query.data?.latestTest) || query.data?.availability.state === 'testing');
  if (!query.data) {
    return (
      <Card title={t('admin.profile.editTitle', { name })} extra={<Button onClick={onClose}>{t('admin.profile.close')}</Button>}>
        <QueryStatus isPending={query.isPending} error={query.error} />
      </Card>
    );
  }
  return <ProfileEditorForm detail={query.data} onClose={onClose} onCreated={onCreated} />;
}

function EditorTitle({ detail }: { readonly detail: ComputeProfileDetailDto | undefined }): ReactElement {
  const t = useT();
  if (!detail) return <>{t('admin.profile.createTitle')}</>;
  return <span className={styles.toolbar}><code>{detail.name}</code> <AvailabilityBadge availability={detail.availability} />{detail.isDefault ? <Badge tone="info">{t('admin.profile.defaultBadge')}</Badge> : null}</span>;
}

function StepsSection({ editor, disabled }: { readonly editor: ProfileDraftHandle; readonly disabled: boolean }): ReactElement {
  const t = useT();
  const selected = editor.selected !== null ? editor.draft.steps[editor.selected] : undefined;
  return (
    <div className={styles.sub}>
      <h3>{t('admin.profile.section.steps')}</h3>
      <p className={styles.hint}>{t('admin.profile.stepsHint', { max: BEFORE_START_LIMITS.maxSteps })}</p>
      <div className={styles.layout}>
        <BeforeStartStepList steps={editor.draft.steps} selected={editor.selected} errors={editor.errors} disabled={disabled} onSelect={editor.setSelected} onAdd={editor.addStep} onMove={editor.moveStep} onDuplicate={editor.duplicateStep} onRemove={editor.removeStep} />
        {selected !== undefined && editor.selected !== null ? <BeforeStartStepEditor step={selected} index={editor.selected} errors={editor.errors} disabled={disabled} onChange={(patch) => editor.changeStep(editor.selected!, patch)} /> : null}
      </div>
    </div>
  );
}

function ProfileEditorForm({ detail, onClose, onCreated }: { readonly detail?: ComputeProfileDetailDto; readonly onClose: () => void; readonly onCreated: (name: string) => void }): ReactElement {
  const t = useT(), creating = detail === undefined;
  const editor = useProfileDraft(detail ? draftFromDetail(detail) : blankDraft('claude-code', 'claude-settings'), detail?.revision);
  const tasks = useApiQuery(queryKeys.taskProfiles(), () => api.catalog.listTaskProfiles());
  const saving = useProfileSave(detail, editor, onCreated);
  const busy = saving.busy, errorCount = Object.keys(editor.errors).length;
  return (
    <Card compact title={<EditorTitle detail={detail} />} extra={<Button onClick={onClose}>{t('admin.profile.close')}</Button>} footer={t('admin.profile.editorHint')}>
      <UnsavedChangesGuard dirty={editor.dirty || busy} scope={t('admin.profile.title')} />
      {detail ? <p className={styles.hint} title={detail.imageDigest}>{t('admin.profile.revisionNote', { revision: detail.revision, hash: detail.contentHash.slice(0, 12), digest: detail.imageDigest ? shortDigest(detail.imageDigest) : '—' })}</p> : null}
      <ProfileBasicsSection draft={editor.draft} errors={editor.errors} disabled={busy} creating={creating} onChange={editor.update} />
      <ProfileLaunchSection draft={editor.draft} errors={editor.errors} disabled={busy} taskProfiles={tasks.data?.items ?? []} taskProfilesUnavailable={!tasks.data || !!tasks.error} onChange={editor.update} />
      <StepsSection editor={editor} disabled={busy} />
      <ProfileVariablesEditor draft={editor.draft} errors={editor.errors} credentials={detail?.credentials ?? []} disabled={busy} onChange={editor.update} />
      <ConfigFileSection draft={editor.draft} errors={editor.errors} disabled={busy} onChange={editor.update} />
      <TerminalTestSection draft={editor.draft} errors={editor.errors} disabled={busy} onChange={editor.update} />
      <div className={styles.toolbar}>
        <Button variant="primary" disabled={busy || (!creating && !editor.dirty)} onClick={saving.submit}>{saving.save.isPending ? t('admin.profile.saving') : creating ? t('admin.profile.createSubmit') : t('admin.profile.save')}</Button>
        {editor.dirty && !creating ? <Badge tone="warning">{t('admin.profile.dirty')}</Badge> : null}
        {errorCount > 0 ? <Badge tone="danger">{t('admin.profile.errorCount', { count: errorCount })}</Badge> : null}
      </div>
      {saving.note?.kind === 'revision' ? <ActionNote tone="success">{t('admin.profile.saved', { revision: saving.note.revision })}</ActionNote> : null}
      {saving.note?.kind === 'description' ? <ActionNote tone="success">{t('admin.profile.savedDescription')}</ActionNote> : null}
      {saving.conflict !== undefined ? (
        <ActionNote tone="error">
          {t('admin.profile.conflict', { revision: saving.conflict })}{' '}
          <Button onClick={() => { editor.adoptRevision(saving.conflict!); saving.clearConflict(); }}>{t('admin.profile.adoptConflict', { revision: saving.conflict })}</Button>{' '}
          <Button onClick={() => saving.reload.mutate(undefined)}>{t('admin.profile.discard')}</Button>
        </ActionNote>
      ) : saving.save.error ? <ActionNote tone="error">{t('admin.profile.saveError', { message: errorMessage(saving.save.error) })}</ActionNote> : null}
      {detail ? <ProfileTestPanel name={detail.name} latest={detail.latestTest} dirty={editor.dirty} onLocate={(stepId) => { const index = editor.draft.steps.findIndex((step) => step.stepId === stepId); if (index >= 0) editor.setSelected(index); }} /> : null}
    </Card>
  );
}
