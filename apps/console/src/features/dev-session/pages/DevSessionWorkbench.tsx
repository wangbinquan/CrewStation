import type { ReleaseDevSessionResult } from '@crewstation/api-client';
import type { DevSessionDto } from '@crewstation/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { Link } from '@tanstack/react-router';
import type { ApiClientError } from '../../../shared/api/useApi';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { UnsavedChangesGuard } from '../../../shared/navigation/UnsavedChangesGuard';
import { useT } from '../../../shared/lib/useT';
import { DataBindingPane } from '../components/DataBindingPane';
import { SessionCard } from '../components/SessionCard';
import { EditorPane } from '../components/editor/EditorPane';
import { DevelopmentPreview } from '../components/preview/DevelopmentPreview';
import { NativeWorkspace } from '../components/native/NativeWorkspace';
import { StreamStatus } from '../components/StreamStatus';
import { VersionComparisonPanel } from '../components/workspace/VersionComparisonPanel';
import { useActivityTouch } from '../hooks/useActivityTouch';
import { useDataBindings } from '../hooks/useDataBindings';
import { useFileEditor } from '../hooks/useFileEditor';
import { usePreviewStatus } from '../hooks/usePreviewStatus';
import { useTaskStream } from '../hooks/useTaskStream';
import { useWorkspaceTree } from '../hooks/useWorkspaceTree';
import { useDevelopmentLocation } from '../hooks/layout/useDevelopmentLocation';
import type { SessionAccess } from '../model/sessionAccess';
import type { ActivityTarget } from '../../../shared/activity/agentActivityView';
import { productionAccessModes } from '../model/dataAccessForm';
import styles from './DevSessionWorkbench.module.css';

export interface DevSessionWorkbenchProps {
  readonly projectId: string;
  readonly session: DevSessionDto;
  readonly access: SessionAccess;
  readonly canDevelop: boolean;
  readonly serviceId: string | undefined;
  readonly userId: string;
  readonly release: UseMutationResult<ReleaseDevSessionResult, ApiClientError, boolean>;
  readonly activityTarget?: ActivityTarget;
}

/**
 * 有会话时的工作区：一条任务流供四个面板共用，外加发布与数据绑定。
 * 所有面板都只拿 channel，不各自开连接。
 */
export function DevSessionWorkbench({ projectId, session, access, canDevelop, serviceId, userId, release, activityTarget }: DevSessionWorkbenchProps): ReactElement {
  const t = useT();
  const { space } = useProjectScope();
  const taskId = session.taskId;
  const { state, channel } = useTaskStream(taskId);
  const touch = useActivityTouch(taskId);
  const tree = useWorkspaceTree(channel, state.generation, state.runnerConnected);
  const editor = useFileEditor(channel);
  const location = useDevelopmentLocation(taskId, editor, state.runnerConnected);
  const preview = usePreviewStatus(channel, state.generation, state.runnerConnected);
  const data = useDataBindings(projectId, taskId, serviceId, { canDevelop, canManage: access.isOwner });
  const [dataDirty, setDataDirty] = useState(false);
  const draftScope = [editor.dirty ? t('devSession.editor.draftScope', { path: editor.file?.path ?? '' }) : '', dataDirty ? t('devSession.data.title') : ''].filter(Boolean).join(' / ');
  const productionModes = productionAccessModes(data.bindings, data.checkedAt);
  const pendingBindings = data.bindings.filter((binding) => binding.state === 'requested').length;
  const accessSummary = data.loadError ? t('devSession.data.unconfirmed') : [productionModes.length ? t('devSession.data.grantedSummary', { modes: productionModes.map((mode) => t(`devSession.data.mode.${mode}`)).join(' / ') }) : '', pendingBindings ? t('devSession.data.pendingCount', { count: pendingBindings }) : ''].filter(Boolean).join(' · ');
  return (
    <>
      <UnsavedChangesGuard dirty={editor.dirty || dataDirty} scope={draftScope}
        isNavigationBusy={(next) => !!location.fileChange(next) && editor.busy}
        allowNavigate={(current, next) => current.pathname === next.pathname && !('view' in next.search && next.search.view === 'conversation') && (!editor.dirty || !location.fileChange(next))}
        confirmationForNavigation={(next) => { const file = location.fileChange(next); return file ? { question: t('devSession.editor.openQuestion', { from: editor.file?.path ?? '', to: file }), confirmLabel: t('devSession.editor.discardOpen', { path: file }) } : undefined; }} onDiscard={location.approveFile} />
      <header className={styles.context}><strong>{t('devSession.title')}</strong><StreamStatus state={state} />
        <details className={styles.disclosure}><summary>{t('devSession.data.title')}{accessSummary ? ` · ${accessSummary}` : ''}{dataDirty ? ` · ${t('devSession.editor.dirty')}` : ''}</summary><div><DataBindingPane data={data} onDirtyChange={setDataDirty} /></div></details>
        <details className={styles.disclosure}><summary>{t('devSession.native.sessionMenu')}</summary><div><SessionCard session={session} stream={state} access={access} release={release} unsavedFile={editor.dirty ? editor.file?.path : undefined} editorBusy={editor.busy} dataAccessDirty={dataDirty} dataAccessBusy={data.busy} onOpenFile={location.openFile} /><Link to={PROJECT_PATHS[space].conversations} params={{ projectId }}>{t('devSession.native.history')}</Link></div></details>
        <Link to={PROJECT_PATHS[space].release} params={{ projectId }} search={{ source: 'session' }}>{t('devSession.native.prepareRelease')}</Link>
      </header>
      <VersionComparisonPanel projectId={projectId} taskId={taskId} channel={channel} canDevelop={canDevelop} compact />
      <NativeWorkspace taskId={taskId} userId={userId} channel={channel} stream={state} canDevelop={canDevelop} onActivity={touch} activityTarget={activityTarget} editorDirty={editor.dirty} location={location}
        preview={<DevelopmentPreview preview={preview} previewHost={session.previewHost} connected={state.runnerConnected} logs={<Link to={PROJECT_PATHS[space].operations} params={{ projectId }} search={{ tab: 'logs', source: 'dev-session', taskId }}>{t('devSession.preview.logs')}</Link>} />}
        editor={<EditorPane tree={tree} editor={{ ...editor, openFile: location.openFile }} />}
        changes={<VersionComparisonPanel projectId={projectId} taskId={taskId} channel={channel} canDevelop={canDevelop} initiallyExpanded target={location.search.target ?? 'prod'} onTargetChange={location.selectTarget} onOpenFile={location.openFile} />} />
    </>
  );
}
