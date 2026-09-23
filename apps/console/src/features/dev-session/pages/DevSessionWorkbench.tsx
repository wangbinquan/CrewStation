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
import { canReleaseSession } from '../model/sessionAccess';
import type { ActivityTarget } from '../../../shared/activity/agentActivityView';
import { ConnectionGuide } from '../components/session/ConnectionGuide';
import { SessionStartup, sessionStartupShown } from '../components/session/SessionStartup';
import { SessionCover } from '../components/session/SessionCover';
import type { WorkspaceReadiness } from '../model/connection/entryProgress';
import { Badge } from '../../../shared/ui/Badge';
import { StageSummary } from '../../../shared/ui/progress/StageProgress';
import { sessionConnection } from '../model/connection/sessionConnection';
import { Stack } from '../../../shared/ui/Stack';
import { Button } from '../../../shared/ui/Button';
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
  readonly isAdmin: boolean; readonly recovery: ReactNode;
  /** 参考面板内容由 app 装配（目录、事件、平台接入分属其他 feature）。 */
  readonly reference?: ReactNode;
  /** 会话面板里内嵌的最近日志，由 app 装配（日志属于 logs feature）。 */
  readonly sessionLogs?: (taskId: string) => ReactNode;
  /** 启动失败在检出代码或更早时的「重试」：按原分支重新开始开发（RFC-022 Q1）。 */
  readonly onRestart?: () => void;
  /** 开始等的时刻（本机时钟）：进页面第一次读会话时由页面给出；之后换了会话（重新开始开发）从工作区挂上时算起。 */
  readonly enteredAt?: number;
}

/**
 * 有会话时的工作区：一条任务流供所有面板共用，外加发布与数据绑定。
 * 所有面板都只拿 channel，不各自开连接。
 */
export function DevSessionWorkbench({ projectId, session, access, canDevelop, serviceId, userId, release, activityTarget, isAdmin, recovery, reference, sessionLogs, onRestart, enteredAt }: DevSessionWorkbenchProps): ReactElement {
  const t = useT();
  const { space } = useProjectScope();
  const taskId = session.taskId;
  // 工作区挂上的时刻就是会话读到的时刻；「仍然打开工作区」只在这一次挂载内有效。
  const [sessionAt] = useState(() => Date.now()), [forced, setForced] = useState(false);
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
  // 页头「释放会话」（2026-09-23 作者裁定）：记下点击并打开会话面板；面板可见时把还没处理的那次交给「当前会话」卡展开确认，
  // 卡片回报后清掉。计数放在这一层：面板从收起到打开时内容整块重挂，放在卡片里会丢，也会重复展开。
  const [releaseAsks, setReleaseAsks] = useState(0), [releaseHandled, setReleaseHandled] = useState(0), sessionPanelOpen = location.search.view === 'session';
  const requestRelease = () => { setReleaseAsks((count) => count + 1); if (!sessionPanelOpen) location.selectTool({ name: 'session', mode: 'side' }); };
  const draftScope = [editor.dirty ? t('devSession.editor.draftScope', { path: editor.file?.path ?? '' }) : '', dataDirty ? t('devSession.data.title') : ''].filter(Boolean).join(' / ');
  const health = sessionConnection(session, state);
  const logs = <ButtonLink size="small" to={PROJECT_PATHS[space].operations} params={{ projectId }} search={{ tab: 'logs', source: 'dev-session', taskId }}>{t('devSession.preview.logs')}</ButtonLink>;
  const diagnostics = { session, stream: state, reconnect, logs };
  const previewLink = state.runnerConnected && preview.confirmed ? previewUrl(session.previewHost, preview.status.state) : undefined;
  // 连接就绪之前整页只有加载层（2026-09-23 作者裁定）：步骤清单、启动步骤条或失败状态卡。
  const gate = { connected: health === 'ready' && !sessionStartupShown(session), forced, cover: (workspace: WorkspaceReadiness) => <SessionCover session={session} stream={state} health={health}
    workspace={workspace} enteredAt={enteredAt ?? sessionAt} sessionAt={sessionAt} canDevelop={canDevelop} logs={logs} recovery={recovery} onReconnect={reconnect}
    {...(onRestart ? { onRestart } : {})} onOpenAnyway={() => setForced(true)} /> };
  return (
    <>
      <UnsavedChangesGuard dirty={editor.dirty || dataDirty} scope={draftScope}
        isNavigationBusy={(next) => !!location.fileChange(next) && editor.busy}
        allowNavigate={(current, next) => current.pathname === next.pathname && !('view' in next.search && next.search.view === 'conversation') && (!editor.dirty || !location.fileChange(next))}
        confirmationForNavigation={(next) => { const file = location.fileChange(next); return file ? { question: t('devSession.editor.openQuestion', { from: editor.file?.path ?? '', to: file }), confirmLabel: t('devSession.editor.discardOpen', { path: file }) } : undefined; }} onDiscard={location.approveFile} />
      <NativeWorkspace header={(newCli) => <>
        <header className={styles.context}>
          <div className={styles.titleRow}><h1 className={styles.title}>{t('devSession.title')}</h1>
            {/* 连接状态芯片可点：直接打开会话面板（RFC-020 §4.3）。 */}
            <button type="button" className={styles.chip} onClick={() => location.selectTool({ name: 'session', mode: 'side' })} title={t('devSession.connection.details')}>
              {session.startup?.state === 'running' ? <Badge tone="info"><StageSummary progress={session.startup} compact /></Badge> : <StreamStatus state={state} sessionState={session.state} compact />}</button>
            <code className={styles.branch} title={session.branch}>{session.branch}</code>
            {health === 'ready' && session.rebuild?.state === 'ready' ? <span className={styles.note} title={session.rebuild.message}>{t('devSession.rebuild.ready')}</span> : null}</div>
          {/* 新开 CLI 只有这一个入口（2026-09-23：原工具行整条去掉）。 */}
          <div className={styles.actions}>
            {newCli}
            {previewLink ? <ExternalButtonLink size="small" href={previewLink}>{t('devSession.native.openPreview')}</ExternalButtonLink> : null}
            <ButtonLink variant="primary" size="small" to={PROJECT_PATHS[space].release} params={{ projectId }} search={{ source: 'session' }}>{t('devSession.native.prepareRelease')}</ButtonLink>
            {/* 危险动作排最后、红字红框；只给会话创建者与负责人。 */}
            {canReleaseSession(access, session) ? <Button variant="danger" size="small" disabled={release.isPending} onClick={requestRelease}>{release.isPending ? t('devSession.release.pending') : t('devSession.release.action')}</Button> : null}
          </div>
        </header>
        {/* 启动中与启动失败由 CLI 区的步骤条说明（RFC-022），不再叠一条连接说明。 */}
        {sessionStartupShown(session) ? null : <div className={styles.guide}><ConnectionGuide {...diagnostics} onEnvironment={location.search.view === 'session' ? undefined : () => location.selectTool({ name: 'session', mode: 'side' })} /></div>}
      </>} startup={sessionStartupShown(session) ? <SessionStartup session={session} canDevelop={canDevelop} {...(onRestart ? { onRestart } : {})} onRecover={() => location.selectTool({ name: 'session', mode: 'side' })} logs={logs} /> : undefined} projectId={projectId} taskId={taskId} userId={userId} channel={channel} stream={state} canDevelop={canDevelop} onActivity={touch} activityTarget={activityTarget} editorDirty={editor.dirty} location={location}
        isAdmin={isAdmin} dataDirty={dataDirty} blockedReason={health !== 'ready' ? t(`devSession.connection.${health}`) : undefined} gate={gate}
        version={health === 'ready' ? <VersionComparisonPanel projectId={projectId} taskId={taskId} channel={channel} canDevelop={canDevelop} compact onDetails={() => location.selectTool({ name: 'changes', mode: 'side' })} /> : null}
        data={<Stack fill><DataResourcesTable projectId={projectId} /><DataBindingPane data={data} onDirtyChange={setDataDirty} /></Stack>}
        reference={reference}
        environment={<Stack fill>
          {/* 「当前会话」在最上面、最近日志在最下面（2026-09-23 作者裁定）；日志是最后一项，面板内容短时由它长到底边。 */}
          <SessionCard session={session} stream={state} access={access} release={release} unsavedFile={editor.dirty ? editor.file?.path : undefined} editorBusy={editor.busy} dataAccessDirty={dataDirty} dataAccessBusy={data.busy} onOpenFile={location.openFile}
            releaseRequest={sessionPanelOpen && releaseAsks > releaseHandled ? releaseAsks : 0} onReleaseRequestHandled={setReleaseHandled} />
          <Card compact stacked title={t('devSession.connection.title')} extra={logs}><StreamStatus state={state} sessionState={session.state} /><p>{t('devSession.connection.automatic')}</p>{recovery}</Card>
          <ButtonLink size="small" to={PROJECT_PATHS[space].conversations} params={{ projectId }}>{t('devSession.native.history')}</ButtonLink>
          {sessionLogs ? sessionLogs(taskId) : null}
        </Stack>}
        preview={<DevelopmentPreview preview={preview} previewHost={session.previewHost} connected={state.runnerConnected} logs={<ButtonLink size="small" to={PROJECT_PATHS[space].operations} params={{ projectId }} search={{ tab: 'logs', source: 'dev-session', taskId }}>{t('devSession.preview.logs')}</ButtonLink>} />}
        editor={<EditorPane tree={tree} editor={{ ...editor, openFile: location.openFile }} serviceId={serviceId} connected={state.runnerConnected} />}
        changes={<VersionComparisonPanel projectId={projectId} taskId={taskId} channel={channel} canDevelop={canDevelop} initiallyExpanded target={location.search.target ?? 'prod'} onTargetChange={location.selectTarget} onOpenFile={location.openFile} />} />
    </>
  );
}
