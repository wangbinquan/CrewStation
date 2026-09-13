import type { ReleaseDevSessionResult } from '@crewstation/api-client';
import type { DevSessionDto } from '@crewstation/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Link } from '@tanstack/react-router';
import type { ApiClientError } from '../../../shared/api/useApi';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { UnsavedChangesGuard } from '../../../shared/navigation/UnsavedChangesGuard';
import { useT } from '../../../shared/lib/useT';
import { DataBindingPane } from '../components/DataBindingPane';
import { PublishPane } from '../components/PublishPane';
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
import { usePublishForm } from '../hooks/usePublishForm';
import { useTaskStream } from '../hooks/useTaskStream';
import { useWorkspaceTree } from '../hooks/useWorkspaceTree';
import type { SessionAccess } from '../model/sessionAccess';
import type { ActivityTarget } from '../../../shared/activity/agentActivityView';
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
  const preview = usePreviewStatus(channel, state.generation, state.runnerConnected);
  const publish = usePublishForm(projectId);
  const data = useDataBindings(projectId, taskId, serviceId);
  return (
    <>
      <UnsavedChangesGuard dirty={editor.dirty} scope={t('devSession.editor.draftScope', { path: editor.file?.path ?? '' })} allowNavigate={(current, next) => current.pathname === next.pathname && !('view' in next.search && next.search.view === 'conversation')} />
      <header className={styles.context}><strong>{t('devSession.title')}</strong><StreamStatus state={state} />
        <details className={styles.disclosure}><summary>{t('devSession.data.title')}{data.bindings.some((binding) => binding.mode !== 'development' && ['active', 'approved'].includes(binding.state)) ? ` · ${t('devSession.native.productionAccess')}` : ''}</summary><div><DataBindingPane data={data} /></div></details>
        <details className={styles.disclosure}><summary>{t('devSession.native.sessionMenu')}</summary><div><SessionCard session={session} stream={state} access={access} release={release} unsavedFile={editor.dirty ? editor.file?.path : undefined} editorBusy={editor.busy} /><Link to={PROJECT_PATHS[space].conversations} params={{ projectId }}>{t('devSession.native.history')}</Link></div></details>
        <details className={styles.disclosure}><summary>{t('devSession.native.prepareRelease')}</summary><div><PublishPane publish={publish} /></div></details>
      </header>
      <VersionComparisonPanel projectId={projectId} taskId={taskId} channel={channel} canDevelop={canDevelop} compact />
      <NativeWorkspace taskId={taskId} userId={userId} channel={channel} stream={state} canDevelop={canDevelop} onActivity={touch} activityTarget={activityTarget} editorDirty={editor.dirty}
        preview={<DevelopmentPreview preview={preview} previewHost={session.previewHost} connected={state.runnerConnected} />}
        editor={<EditorPane tree={tree} editor={editor} />}
        changes={<VersionComparisonPanel projectId={projectId} taskId={taskId} channel={channel} canDevelop={canDevelop} initiallyExpanded />} />
    </>
  );
}
