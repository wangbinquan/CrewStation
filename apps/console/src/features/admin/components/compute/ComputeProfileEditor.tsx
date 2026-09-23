import type { ComputeProfileDetailDto } from '@crewstation/contracts';
import { BEFORE_START_LIMITS } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useRef } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiQuery } from '../../../../shared/api/useApi';
import { usePollingRefetch } from '../../../../shared/lib/usePollingRefetch';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { Tabs } from '../../../../shared/ui/Tabs';
import { useProfileDraft } from '../../hooks/useProfileDraft';
import type { ProfileDraftHandle } from '../../hooks/useProfileDraft';
import { useProfileSave } from '../../hooks/useProfileSave';
import { EDITOR_SECTIONS, sectionForError, useProfileEditorView } from '../../hooks/useProfileEditorView';
import { blankDraft, draftFromDetail } from '../../model/profileDraft';
import { shortDigest, testRunning } from '../../model/profileStatus';
import { BeforeStartStepEditor } from './BeforeStartStepEditor';
import { BeforeStartStepList } from './BeforeStartStepList';
import styles from './ComputeEditor.module.css';
import { ProfileBasicsSection } from './ProfileBasicsSection';
import { ProfileLaunchSection } from './ProfileLaunchSection';
import { ProfileEditorFeedback } from './ProfileEditorFeedback';
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
      <Card title={t('admin.profile.editTitle', { name })} extra={<Button variant="ghost" onClick={onClose}>{t('admin.profile.close')}</Button>}>
        <QueryStatus isPending={query.isPending} error={query.error} />
      </Card>
    );
  }
  return <ProfileEditorForm detail={query.data} onClose={onClose} onCreated={onCreated} />;
}

function EditorTitle({ detail }: { readonly detail: ComputeProfileDetailDto | undefined }): ReactElement {
  const t = useT();
  if (!detail) return <>{t('admin.profile.createTitle')}</>;
  return <span className={styles.profileSummary}>
    <span className={styles.toolbar}><span className={styles.profileName}>{detail.name}</span><span className={styles.hint}>{t(`admin.profile.protocol.${detail.protocol}`)}</span><AvailabilityBadge availability={detail.availability} />{detail.isDefault ? <Badge tone="info">{t('admin.profile.defaultBadge')}</Badge> : null}</span>
    <span className={styles.hint} title={detail.imageDigest}>{t('admin.profile.revisionNote', { revision: detail.revision, hash: detail.contentHash.slice(0, 12), digest: detail.imageDigest ? shortDigest(detail.imageDigest) : '—' })}</span>
  </span>;
}

function StepsSection({ editor, disabled, onSelect }: { readonly editor: ProfileDraftHandle; readonly disabled: boolean; readonly onSelect: (index: number) => void }): ReactElement {
  const t = useT();
  const selected = editor.selected !== null ? editor.draft.steps[editor.selected] : undefined;
  return (
    <div className={styles.sub}>
      <h3>{t('admin.profile.section.steps')}</h3>
      <p className={styles.hint}>{t('admin.profile.stepsHint', { max: BEFORE_START_LIMITS.maxSteps })}</p>
      <div className={styles.layout}>
        <BeforeStartStepList steps={editor.draft.steps} selected={editor.selected} errors={editor.errors} disabled={disabled} onSelect={onSelect} onAdd={editor.addStep} onMove={editor.moveStep} onDuplicate={editor.duplicateStep} onRemove={editor.removeStep} />
        {selected !== undefined && editor.selected !== null ? <div className={styles.stepEditor} data-step-editor>
          <div className={styles.sectionHeading}><h4>{t('admin.profile.editor.stepTitle', { number: editor.selected + 1 })}</h4><Badge>{t(`admin.profile.step.kind.${selected.kind}`)}</Badge></div>
          <BeforeStartStepEditor step={selected} index={editor.selected} errors={editor.errors} disabled={disabled} onChange={(patch) => editor.changeStep(editor.selected!, patch)} />
        </div> : <div className={styles.stepEmpty}>{t('admin.profile.editor.selectStep')}</div>}
      </div>
    </div>
  );
}

function ProfileEditorForm({ detail, onClose, onCreated }: { readonly detail?: ComputeProfileDetailDto; readonly onClose: () => void; readonly onCreated: (name: string) => void }): ReactElement {
  const t = useT(), creating = detail === undefined;
  const editor = useProfileDraft(detail ? draftFromDetail(detail) : blankDraft('claude-code', 'claude-settings'), detail?.revision);
  const root = useRef<HTMLDivElement>(null);
  const view = useProfileEditorView(editor, root);
  const tasks = useApiQuery(queryKeys.taskProfiles(), () => api.catalog.listTaskProfiles());
  const saving = useProfileSave(detail, editor, onCreated, view);
  const busy = saving.busy;
  const items = EDITOR_SECTIONS.map((value) => {
    const count = Object.keys(editor.errors).filter((field) => sectionForError(field) === value).length;
    return { value, label: <span className={styles.toolbar}>{t(`admin.profile.editor.tab.${value}`)}{count ? <Badge tone="danger">{count}</Badge> : null}</span> };
  });
  return (
    <Card className={styles.editorCard} title={<EditorTitle detail={detail} />} extra={<Button variant="ghost" onClick={onClose}>{t('admin.profile.close')}</Button>}>
      <div ref={root} className={styles.contents}>
      <UnsavedChangesGuard dirty={editor.dirty || busy} scope={t('admin.profile.title')} />
      <ProfileEditorFeedback editor={editor} saving={saving} creating={creating} />
      <Tabs label={t('admin.profile.editor.navigation')} items={items} value={view.section} onChange={view.select}>
        <div data-editor-section="basics" hidden={view.section !== 'basics'} className={styles.panel}>
          <ProfileBasicsSection draft={editor.draft} errors={editor.errors} disabled={busy} creating={creating} onChange={editor.update} />
          <ProfileLaunchSection draft={editor.draft} errors={editor.errors} disabled={busy} taskProfiles={tasks.data?.items ?? []} taskProfilesUnavailable={!tasks.data || !!tasks.error} onChange={editor.update} />
        </div>
        <div data-editor-section="startup" hidden={view.section !== 'startup'} className={styles.panel}>
          <StepsSection editor={editor} disabled={busy} onSelect={view.selectStep} />
          <ConfigFileSection draft={editor.draft} errors={editor.errors} disabled={busy} onChange={editor.update} />
        </div>
        <div data-editor-section="variables" hidden={view.section !== 'variables'} className={styles.panel}>
          <ProfileVariablesEditor draft={editor.draft} errors={editor.errors} credentials={detail?.credentials ?? []} disabled={busy} onChange={editor.update} />
        </div>
        <div data-editor-section="test" hidden={view.section !== 'test'} className={styles.panel}>
          <TerminalTestSection draft={editor.draft} errors={editor.errors} disabled={busy} onChange={editor.update} />
          {detail ? <ProfileTestPanel name={detail.id} latest={detail.latestTest} dirty={editor.dirty} onLocate={view.locate} /> : <p className={styles.stepEmpty}>{t('admin.profile.editor.createTestHint')}</p>}
        </div>
      </Tabs>
      </div>
    </Card>
  );
}
