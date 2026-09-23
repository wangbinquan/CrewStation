import type { ReleaseDevSessionResult } from '@crewstation/api-client';
import type { DevSessionDto } from '@crewstation/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
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
import { DataResourcesTable } from '../components/panel/DataResourcesTable';
import { useActivityTouch } from '../hooks/useActivityTouch';
import { useDataBindings } from '../hooks/useDataBindings';
import { useFileEditor } from '../hooks/useFileEditor';
import { usePreviewStatus } from '../hooks/usePreviewStatus';
import { useTaskStream } from '../hooks/useTaskStream';
import { useWorkspaceTree } from '../hooks/useWorkspaceTree';
import { useDevelopmentLocation } from '../hooks/layout/useDevelopmentLocation';
import type { SessionAccess } from '../model/sessionAccess';
import type { ActivityTarget } from '../../../shared/activity/agentActivityView';
import { ConnectionGuide } from '../components/session/ConnectionGuide';
import { sessionConnection } from '../model/connection/sessionConnection';
import { Stack } from '../../../shared/ui/Stack';
import { Card } from '../../../shared/ui/Card';
import { previewUrl } from '../model/previewSnapshot';
import styles from './DevSessionWorkbench.module.css';
import { ButtonLink, ExternalButtonLink } from '../../../shared/ui/navigation/ButtonLink';

export interface DevSessionWorkbenchProps {
  readonly projectId: string;
  readonly session: DevSessionDto;
  readonly access: SessionAccess;
  readonly canDevelop: boolean;
  readonly serviceId: string | undefined;
  readonly userId: string;
  readonly release: UseMutationResult<ReleaseDevSessionResult, ApiClientError, boolean>;
  readonly activityTarget?: ActivityTarget;
  readonly isAdmin: boolean; readonly recovery: ReactNode; readonly refresh: () => Promise<unknown>; readonly refreshing: boolean;
  /** 参考面板内容由 app 装配（目录、事件、平台接入分属其他 feature）。 */
  readonly reference?: ReactNode;
  /** 会话面板里内嵌的最近日志，由 app 装配（日志属于 logs feature）。 */
  readonly sessionLogs?: (taskId: string) => ReactNode;
}

/**
 * 有会话时的工作区：一条任务流供所有面板共用，外加发布与数据绑定。
 * 所有面板都只拿 channel，不各自开连接。
 */
export function DevSessionWorkbench({ projectId, session, access, canDevelop, serviceId, userId, release, activityTarget, isAdmin, recovery, refresh, refreshing, reference, sessionLogs }: DevSessionWorkbenchProps): ReactElement {
  const t = useT();
  const { space } = useProjectScope();
  const taskId = session.taskId;
  // 原生 CLI 工作区只要最近一页历史：终端按快照恢复，名册／动态各有持久查询；几万条旧事件逐页回放只会让页面长时间“连接中”。
  const { state: connection, channel, reconnect } = useTaskStream(taskId, true, { replay: 'tail' });
  const state = session.state !== 'running' || session.connectionIssue ? { ...connection, runnerConnected: false } : connection;
  const touch = useActivityTouch(taskId);
  const tree = useWorkspaceTree(channel, state.generation, state.runnerConnected);
  const editor = useFileEditor(channel);
  const location = useDevelopmentLocation(taskId, editor, state.runnerConnected);
  const preview = usePreviewStatus(channel, projectId, state.generation, state.runnerConnected);
  const data = useDataBindings(projectId, taskId, serviceId, { canDevelop, canManage: access.isOwner });
  const [dataDirty, setDataDirty] = useState(false);
  const draftScope = [editor.dirty ? t('devSession.editor.draftScope', { path: editor.file?.path ?? '' }) : '', dataDirty ? t('devSession.data.title') : ''].filter(Boolean).join(' / ');
  const health = sessionConnection(session, state);
  const logs = <ButtonLink size="small" to={PROJECT_PATHS[space].operations} params={{ projectId }} search={{ tab: 'logs', source: 'dev-session', taskId }}>{t('devSession.preview.logs')}</ButtonLink>;
  const diagnostics = { session, stream: state, refresh, refreshing, reconnect, logs };
  const previewLink = state.runnerConnected && preview.confirmed ? previewUrl(session.previewHost, preview.status.state) : undefined;
  return (
    <>
      <UnsavedChangesGuard dirty={editor.dirty || dataDirty} scope={draftScope}
        isNavigationBusy={(next) => !!location.fileChange(next) && editor.busy}
        allowNavigate={(current, next) => current.pathname === next.pathname && !('view' in next.search && next.search.view === 'conversation') && (!editor.dirty || !location.fileChange(next))}
        confirmationForNavigation={(next) => { const file = location.fileChange(next); return file ? { question: t('devSession.editor.openQuestion', { from: editor.file?.path ?? '', to: file }), confirmLabel: t('devSession.editor.discardOpen', { path: file }) } : undefined; }} onDiscard={location.approveFile} />
      <header className={styles.context}>
        <div className={styles.titleRow}><h1 className={styles.title}>{t('devSession.title')}</h1>
          {/* 连接状态芯片可点：直接打开会话面板（RFC-020 §4.3）。 */}
          <button type="button" className={styles.chip} onClick={() => location.selectTool({ name: 'session', mode: 'side' })} title={t('devSession.connection.details')}><StreamStatus state={state} sessionState={session.state} compact /></button>
          <code className={styles.branch} title={session.branch}>{session.branch}</code>
          {health === 'ready' && session.rebuild?.state === 'ready' ? <span className={styles.note} title={session.rebuild.message}>{t('devSession.rebuild.ready')}</span> : null}</div>
        <div className={styles.actions}>
          {previewLink ? <ExternalButtonLink size="small" href={previewLink}>{t('devSession.native.openPreview')}</ExternalButtonLink> : null}
          <ButtonLink variant="primary" size="small" to={PROJECT_PATHS[space].release} params={{ projectId }} search={{ source: 'session' }}>{t('devSession.native.prepareRelease')}</ButtonLink>
        </div>
      </header>
      <div className={styles.guide}><ConnectionGuide {...diagnostics} onEnvironment={location.search.view === 'session' ? undefined : () => location.selectTool({ name: 'session', mode: 'side' })} /></div>
      <NativeWorkspace projectId={projectId} taskId={taskId} userId={userId} channel={channel} stream={state} canDevelop={canDevelop} onActivity={touch} activityTarget={activityTarget} editorDirty={editor.dirty} location={location}
        isAdmin={isAdmin} dataDirty={dataDirty} blockedReason={health !== 'ready' ? t(`devSession.connection.${health}`) : undefined}
        version={health === 'ready' ? <VersionComparisonPanel projectId={projectId} taskId={taskId} channel={channel} canDevelop={canDevelop} compact onDetails={() => location.selectTool({ name: 'changes', mode: 'side' })} /> : null}
        data={<Stack fill><DataResourcesTable projectId={projectId} /><DataBindingPane data={data} onDirtyChange={setDataDirty} /></Stack>}
        reference={reference}
        environment={<Stack fill>
          <Card compact stacked title={t('devSession.connection.title')} extra={logs}><StreamStatus state={state} sessionState={session.state} /><p>{t('devSession.connection.automatic')}</p>{recovery}</Card>
          {sessionLogs ? sessionLogs(taskId) : null}
          <ButtonLink size="small" to={PROJECT_PATHS[space].conversations} params={{ projectId }}>{t('devSession.native.history')}</ButtonLink>
          <SessionCard session={session} stream={state} access={access} release={release} unsavedFile={editor.dirty ? editor.file?.path : undefined} editorBusy={editor.busy} dataAccessDirty={dataDirty} dataAccessBusy={data.busy} onOpenFile={location.openFile} />
        </Stack>}
        preview={<DevelopmentPreview preview={preview} previewHost={session.previewHost} connected={state.runnerConnected} logs={<ButtonLink variant="ghost" to={PROJECT_PATHS[space].operations} params={{ projectId }} search={{ tab: 'logs', source: 'dev-session', taskId }}>{t('devSession.preview.logs')}</ButtonLink>} />}
        editor={<EditorPane tree={tree} editor={{ ...editor, openFile: location.openFile }} serviceId={serviceId} connected={state.runnerConnected} />}
        changes={<VersionComparisonPanel projectId={projectId} taskId={taskId} channel={channel} canDevelop={canDevelop} initiallyExpanded target={location.search.target ?? 'prod'} onTargetChange={location.selectTarget} onOpenFile={location.openFile} />} />
    </>
  );
}
